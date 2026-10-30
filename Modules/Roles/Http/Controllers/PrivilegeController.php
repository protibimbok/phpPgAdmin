<?php

declare(strict_types=1);

namespace PhpPgAdmin\Modules\Roles\Http\Controllers;

use League\Route\Http\Exception\BadRequestException;
use League\Route\Http\Exception\NotFoundException;
use PhpPgAdmin\Core\Database\Connection;
use PhpPgAdmin\Core\Database\Quoting;
use PhpPgAdmin\Core\Nodes\Ddl;
use PhpPgAdmin\Modules\Roles\Privileges\PrivilegeSql;

/**
 * The privileges on one object (a database, tablespace, schema, relation, sequence, routine,
 * type, language, foreign data wrapper or foreign server) and its columns, the default privileges of a database or schema, and the grant
 * wizard's bulk GRANT: what pgAdmin edits in each node's Security tab, its Default Privileges tab and its
 * Grant Wizard. Privileges are read with aclexplode() over the ACL or, when it is NULL, the
 * built-in default, so what the owner and PUBLIC hold implicitly shows too.
 */
final class PrivilegeController
{
    private const array RELATION = ['INSERT', 'SELECT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'];

    private const array COLUMN = ['INSERT', 'SELECT', 'UPDATE', 'REFERENCES'];

    /** pg_default_acl.defaclobjtype → the keyword ALTER DEFAULT PRIVILEGES writes, what it allows and acldefault()'s code. */
    private const array DEFAULTS = [
        'r' => ['target' => 'TABLES', 'privileges' => self::RELATION, 'acldefault' => 'r'],
        'S' => ['target' => 'SEQUENCES', 'privileges' => ['USAGE', 'SELECT', 'UPDATE'], 'acldefault' => 's'],
        'f' => ['target' => 'FUNCTIONS', 'privileges' => ['EXECUTE'], 'acldefault' => 'f'],
        'T' => ['target' => 'TYPES', 'privileges' => ['USAGE'], 'acldefault' => 'T'],
        'n' => ['target' => 'SCHEMAS', 'privileges' => ['USAGE', 'CREATE'], 'acldefault' => 'n'],
    ];

    /**
     * The object, its grantees and, for a relation, the grantees of each column.
     *
     * @return array{object: array{kind: string, name: string, owner: string, type: ?string}, allowed: list<string>, acl: list<array<string, mixed>>, columns?: list<array{name: string, acl: list<array<string, mixed>>}>, column_allowed?: list<string>}
     */
    public function show(Connection $conn, string $kind, int $oid): array
    {
        $object = $this->object($conn, $kind, $oid);
        $result = [
            'object' => ['kind' => $object['kind'], 'name' => $object['name'], 'owner' => $object['owner'], 'type' => $object['type']],
            'allowed' => $object['allowed'],
            'acl' => $this->grantees($conn, $object['acl']),
        ];

        if ($kind === 'table') {
            $result['column_allowed'] = self::COLUMN;
            $result['columns'] = array_map(fn (array $column): array => ['name' => $column['attname'], 'acl' => $this->grantees($conn, $column['attacl'])], $conn->rows(
                'SELECT attname, attacl FROM pg_catalog.pg_attribute WHERE attrelid = $1 AND attnum > 0 AND NOT attisdropped ORDER BY attnum',
                [$oid],
            ));
        }

        return $result;
    }

    /**
     * The statements that give the grantee exactly the privileges the data lists on the object,
     * or on one of its columns: {grantee, privileges: [{privilege, with_grant}], column?}.
     *
     * @param array<string, mixed> $data
     */
    public function sql(Connection $conn, string $kind, int $oid, array $data): string
    {
        $object = $this->object($conn, $kind, $oid);
        $grantee = $this->grantee($data);
        $column = trim((string) ($data['column'] ?? ''));

        if ($column !== '') {
            if ($kind !== 'table') {
                throw new BadRequestException('Only a table, view or foreign table has column privileges.');
            }
            $acl = $conn->scalar('SELECT attacl FROM pg_catalog.pg_attribute WHERE attrelid = $1 AND attname = $2 AND NOT attisdropped', [$oid, $column]);
            $old = $this->privilegesOf($this->grantees($conn, $acl), $grantee);

            return Ddl::assemble(PrivilegeSql::diff('', $object['target'], $grantee, $old, PrivilegeSql::fromClient($data['privileges'] ?? [], self::COLUMN), $column));
        }

        $old = $this->privilegesOf($this->grantees($conn, $object['acl']), $grantee);

        return Ddl::assemble(PrivilegeSql::diff('', $object['target'], $grantee, $old, PrivilegeSql::fromClient($data['privileges'] ?? [], $object['allowed'])));
    }

    /**
     * The default privileges of the database (scid null: those for every schema) or of a schema:
     * one row per role whose new objects they apply to, kind of object and grantee.
     *
     * @return array{rows: list<array<string, mixed>>, allowed: array<string, list<string>>}
     */
    public function defaults(Connection $conn, ?int $scid): array
    {
        $rows = [];
        foreach ($conn->rows(
            'SELECT pg_catalog.pg_get_userbyid(defaclrole) AS role, defaclobjtype AS objtype, defaclacl AS acl FROM pg_catalog.pg_default_acl WHERE defaclnamespace = $1 ORDER BY 1, 2',
            [$scid ?? 0],
        ) as $row) {
            foreach ($this->grantees($conn, $row['acl']) as $grantee) {
                $rows[] = ['role' => $row['role'], 'objtype' => $row['objtype'], ...$grantee];
            }
        }
        $allowed = array_map(static fn (array $spec): array => $spec['privileges'], self::DEFAULTS);
        $allowed['r'] = $this->allowed($conn, 'table', 'r');
        if ($scid !== null) {
            unset($allowed['n']);
        }

        return ['rows' => $rows, 'allowed' => $allowed];
    }

    /**
     * ALTER DEFAULT PRIVILEGES for one (role, kind of object, grantee): {role, objtype, grantee,
     * privileges}. Without a role the defaults are those of the session's own new objects.
     *
     * @param array<string, mixed> $data
     */
    public function defaultsSql(Connection $conn, ?int $scid, array $data): string
    {
        $objtype = (string) ($data['objtype'] ?? '');
        $spec = self::DEFAULTS[$objtype] ?? throw new BadRequestException('Unknown kind of object for default privileges.');
        $allowed = $objtype === 'r' ? $this->allowed($conn, 'table', 'r') : $spec['privileges'];
        if ($objtype === 'n' && $scid !== null) {
            throw new BadRequestException('Default privileges on schemas can only be set for the whole database.');
        }
        $grantee = $this->grantee($data);
        $role = trim((string) ($data['role'] ?? '')) ?: (string) $conn->scalar('SELECT current_user');

        $acl = $conn->scalar(
            'SELECT defaclacl FROM pg_catalog.pg_default_acl WHERE defaclrole = (SELECT oid FROM pg_catalog.pg_roles WHERE rolname = $1) AND defaclnamespace = $2 AND defaclobjtype = $3',
            [$role, $scid ?? 0, $objtype],
        );
        // Without an entry a role's new objects get the built-in defaults (the owner all, PUBLIC EXECUTE / USAGE).
        $acl ??= $scid === null ? $conn->scalar('SELECT pg_catalog.acldefault($1::"char", oid) FROM pg_catalog.pg_roles WHERE rolname = $2', [self::DEFAULTS[$objtype]['acldefault'], $role]) : null;
        $old = $this->privilegesOf($this->grantees($conn, $acl), $grantee);

        $prefix = sprintf('ALTER DEFAULT PRIVILEGES FOR ROLE %s%s ', Quoting::ident($role), $scid === null ? '' : ' IN SCHEMA ' . Quoting::ident($this->schemaName($conn, $scid)));

        return Ddl::assemble(PrivilegeSql::diff($prefix, $spec['target'], $grantee, $old, PrivilegeSql::fromClient($data['privileges'] ?? [], $allowed)));
    }

    /**
     * The objects of a schema the grant wizard offers: relations, sequences and routines.
     *
     * @return list<array{kind: string, oid: int, name: string, type: string, allowed: list<string>}>
     */
    public function wizardObjects(Connection $conn, int $scid): array
    {
        $objects = [];
        foreach ($conn->rows(
            "SELECT 'table' AS kind, c.oid, c.relname AS name, c.relkind::text AS type FROM pg_catalog.pg_class c
              WHERE c.relnamespace = $1 AND c.relkind IN ('r', 'p', 'v', 'm', 'f', 'S') AND NOT c.relispartition
             UNION ALL
             SELECT 'function', p.oid, p.proname || '(' || pg_catalog.pg_get_function_identity_arguments(p.oid) || ')', p.prokind::text FROM pg_catalog.pg_proc p
              WHERE p.pronamespace = $1 AND p.prokind IN ('f', 'p')
             ORDER BY 1 DESC, 3",
            [$scid],
        ) as $row) {
            $kind = $row['type'] === 'S' ? 'sequence' : $row['kind'];
            $objects[] = ['kind' => $kind, 'oid' => (int) $row['oid'], 'name' => $row['name'], 'type' => $row['type'], 'allowed' => $this->allowed($conn, $kind, $row['type'])];
        }

        return $objects;
    }

    /**
     * The grant wizard's GRANT for each object chosen: {objects: [{kind, oid}], grantee,
     * privileges}. Each object gets the privileges it accepts; existing ones are left alone.
     *
     * @param array<string, mixed> $data
     */
    public function wizardSql(Connection $conn, array $data): string
    {
        return $this->wizardStatements($conn, $data)['sql'];
    }

    /**
     * Run the grant wizard's statements as one implicit transaction.
     *
     * @param array<string, mixed> $data
     * @return array{sql: string, objects: int} the statements and how many objects they changed
     */
    public function runWizard(Connection $conn, array $data): array
    {
        $result = $this->wizardStatements($conn, $data);
        $this->run($conn, $result['sql']);

        return $result;
    }

    /**
     * @param array<string, mixed> $data
     * @return array{sql: string, objects: int} the statements, and how many of the objects chosen
     *                                           got one (those already holding everything get none)
     */
    private function wizardStatements(Connection $conn, array $data): array
    {
        $grantee = $this->grantee($data);
        $statements = [];
        $objects = 0;
        foreach (is_array($data['objects'] ?? null) ? $data['objects'] : [] as $item) {
            $object = $this->object($conn, (string) ($item['kind'] ?? ''), (int) ($item['oid'] ?? 0));
            $old = $this->privilegesOf($this->grantees($conn, $object['acl']), $grantee);
            $new = PrivilegeSql::fromClient($data['privileges'] ?? [], $object['allowed']);
            // The wizard adds privileges; what the grantee already holds stays as it is.
            $diff = PrivilegeSql::diff('', $object['target'], $grantee, $old, [...$old, ...array_filter($new, static fn (bool $g, string $p): bool => $g || !isset($old[$p]), ARRAY_FILTER_USE_BOTH)]);
            if ($diff !== []) {
                $statements = [...$statements, ...$diff];
                $objects++;
            }
        }
        if ($statements === []) {
            throw new BadRequestException('Choose at least one object and one privilege it accepts.');
        }

        return ['sql' => Ddl::assemble($statements), 'objects' => $objects];
    }

    /**
     * Run what one of the *Sql methods rendered, as one implicit transaction.
     */
    public function run(Connection $conn, string $sql): void
    {
        if (trim($sql) !== '') {
            $conn->queryMulti($sql);
        }
    }

    /**
     * The databases a role holds privileges on, from the server-wide pg_database: what
     * phpMyAdmin's "Database-specific privileges" table lists for a user.
     *
     * @return list<array{database: string, privileges: list<array{privilege: string, with_grant: bool}>}>
     */
    public function databasesOf(Connection $conn, int $rid): array
    {
        $databases = [];
        foreach ($conn->rows(
            "SELECT d.datname, a.privilege_type, a.is_grantable FROM pg_catalog.pg_database d, pg_catalog.aclexplode(COALESCE(d.datacl, pg_catalog.acldefault('d', d.datdba))) a
             WHERE a.grantee = $1 ORDER BY d.datname",
            [$rid],
        ) as $row) {
            $databases[$row['datname']][] = ['privilege' => $row['privilege_type'], 'with_grant' => (bool) $row['is_grantable']];
        }

        return array_map(static fn (string $database, array $privileges): array => ['database' => $database, 'privileges' => $privileges], array_keys($databases), $databases);
    }

    /**
     * What a kind of object is called in GRANT, its owner, the privileges it accepts and its ACL
     * (or the built-in default when it has none).
     *
     * @return array{kind: string, name: string, owner: string, type: ?string, target: string, allowed: list<string>, acl: mixed}
     */
    private function object(Connection $conn, string $kind, int $oid): array
    {
        $row = match ($kind) {
            'database' => $conn->row("SELECT 'DATABASE' AS keyword, datname AS name, pg_catalog.quote_ident(datname) AS ident, pg_catalog.pg_get_userbyid(datdba) AS owner, COALESCE(datacl, pg_catalog.acldefault('d', datdba)) AS acl, NULL AS type FROM pg_catalog.pg_database WHERE oid = $1", [$oid]),
            'tablespace' => $conn->row("SELECT 'TABLESPACE' AS keyword, spcname AS name, pg_catalog.quote_ident(spcname) AS ident, pg_catalog.pg_get_userbyid(spcowner) AS owner, COALESCE(spcacl, pg_catalog.acldefault('t', spcowner)) AS acl, NULL AS type FROM pg_catalog.pg_tablespace WHERE oid = $1", [$oid]),
            'schema' => $conn->row("SELECT 'SCHEMA' AS keyword, nspname AS name, pg_catalog.quote_ident(nspname) AS ident, pg_catalog.pg_get_userbyid(nspowner) AS owner, COALESCE(nspacl, pg_catalog.acldefault('n', nspowner)) AS acl, NULL AS type FROM pg_catalog.pg_namespace WHERE oid = $1", [$oid]),
            'table', 'sequence' => $conn->row("SELECT CASE WHEN relkind = 'S' THEN 'SEQUENCE' ELSE 'TABLE' END AS keyword, oid::pg_catalog.regclass::text AS name, oid::pg_catalog.regclass::text AS ident, pg_catalog.pg_get_userbyid(relowner) AS owner, COALESCE(relacl, pg_catalog.acldefault((CASE WHEN relkind = 'S' THEN 's' ELSE 'r' END)::\"char\", relowner)) AS acl, relkind::text AS type FROM pg_catalog.pg_class WHERE oid = $1", [$oid]),
            'function' => $conn->row("SELECT CASE WHEN prokind = 'p' THEN 'PROCEDURE' ELSE 'FUNCTION' END AS keyword, oid::pg_catalog.regprocedure::text AS name, oid::pg_catalog.regprocedure::text AS ident, pg_catalog.pg_get_userbyid(proowner) AS owner, COALESCE(proacl, pg_catalog.acldefault('f', proowner)) AS acl, prokind::text AS type FROM pg_catalog.pg_proc WHERE oid = $1", [$oid]),
            'type' => $conn->row("SELECT CASE WHEN typtype = 'd' THEN 'DOMAIN' ELSE 'TYPE' END AS keyword, pg_catalog.format_type(oid, NULL) AS name, pg_catalog.format_type(oid, NULL) AS ident, pg_catalog.pg_get_userbyid(typowner) AS owner, COALESCE(typacl, pg_catalog.acldefault('T', typowner)) AS acl, typtype::text AS type FROM pg_catalog.pg_type WHERE oid = $1", [$oid]),
            // pgAdmin's privilege macro: GRANT … ON LANGUAGE / FOREIGN DATA WRAPPER / FOREIGN SERVER name.
            'language' => $conn->row("SELECT 'LANGUAGE' AS keyword, lanname AS name, pg_catalog.quote_ident(lanname) AS ident, pg_catalog.pg_get_userbyid(lanowner) AS owner, COALESCE(lanacl, pg_catalog.acldefault('l', lanowner)) AS acl, NULL AS type FROM pg_catalog.pg_language WHERE oid = $1", [$oid]),
            'foreign_data_wrapper' => $conn->row("SELECT 'FOREIGN DATA WRAPPER' AS keyword, fdwname AS name, pg_catalog.quote_ident(fdwname) AS ident, pg_catalog.pg_get_userbyid(fdwowner) AS owner, COALESCE(fdwacl, pg_catalog.acldefault('F', fdwowner)) AS acl, NULL AS type FROM pg_catalog.pg_foreign_data_wrapper WHERE oid = $1", [$oid]),
            'foreign_server' => $conn->row("SELECT 'FOREIGN SERVER' AS keyword, srvname AS name, pg_catalog.quote_ident(srvname) AS ident, pg_catalog.pg_get_userbyid(srvowner) AS owner, COALESCE(srvacl, pg_catalog.acldefault('S', srvowner)) AS acl, NULL AS type FROM pg_catalog.pg_foreign_server WHERE oid = $1", [$oid]),
            default => throw new BadRequestException(sprintf('Privileges cannot be set on a "%s".', $kind)),
        } ?? throw new NotFoundException(sprintf('Could not find the %s. It may have been removed by another user.', $kind));

        return [
            'kind' => $kind,
            'name' => (string) $row['name'],
            'owner' => (string) $row['owner'],
            'type' => $row['type'],
            'target' => $row['keyword'] . ' ' . $row['ident'],
            'allowed' => $this->allowed($conn, $kind, $row['type']),
            'acl' => $row['acl'],
        ];
    }

    /** @return list<string> the privileges GRANT accepts on that kind of object */
    private function allowed(Connection $conn, string $kind, ?string $type): array
    {
        return match ($kind) {
            'database' => ['CREATE', 'CONNECT', 'TEMPORARY'],
            'tablespace' => ['CREATE'],
            'schema' => ['USAGE', 'CREATE'],
            'sequence' => ['USAGE', 'SELECT', 'UPDATE'],
            'function' => ['EXECUTE'],
            'type', 'language', 'foreign_data_wrapper', 'foreign_server' => ['USAGE'],
            // MAINTAIN is granted on relations since PostgreSQL 17.
            default => $conn->version() >= 170000 ? [...self::RELATION, 'MAINTAIN'] : self::RELATION,
        };
    }

    /**
     * An ACL as one entry per grantee: its privileges, whether each may be granted on, and who
     * granted them.
     *
     * @return list<array{grantee: string, grantors: list<string>, privileges: list<array{privilege: string, with_grant: bool}>}>
     */
    private function grantees(Connection $conn, mixed $acl): array
    {
        if ($acl === null || $acl === '' || $acl === '{}') {
            return [];
        }
        $grantees = [];
        foreach ($conn->rows(
            "SELECT CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE pg_catalog.pg_get_userbyid(a.grantee) END AS grantee, pg_catalog.pg_get_userbyid(a.grantor) AS grantor, a.privilege_type, a.is_grantable
             FROM pg_catalog.aclexplode($1::pg_catalog.aclitem[]) a ORDER BY a.grantee = 0 DESC, 1",
            [$acl],
        ) as $row) {
            $entry = &$grantees[$row['grantee']];
            $entry['grantee'] = $row['grantee'];
            $entry['grantors'][$row['grantor']] = true;
            $entry['privileges'][$row['privilege_type']] = ($entry['privileges'][$row['privilege_type']] ?? false) || (bool) $row['is_grantable'];
            unset($entry);
        }

        return array_values(array_map(static fn (array $entry): array => [
            'grantee' => $entry['grantee'],
            'grantors' => array_keys($entry['grantors']),
            'privileges' => array_map(static fn (string $privilege, bool $grant): array => ['privilege' => $privilege, 'with_grant' => $grant], array_keys($entry['privileges']), $entry['privileges']),
        ], $grantees));
    }

    /**
     * @param list<array{grantee: string, privileges: list<array{privilege: string, with_grant: bool}>}> $grantees
     * @return array<string, bool>
     */
    private function privilegesOf(array $grantees, string $grantee): array
    {
        foreach ($grantees as $entry) {
            if ($entry['grantee'] === $grantee) {
                return array_column($entry['privileges'], 'with_grant', 'privilege');
            }
        }

        return [];
    }

    /** @param array<string, mixed> $data */
    private function grantee(array $data): string
    {
        $grantee = trim((string) ($data['grantee'] ?? ''));

        return $grantee !== '' ? (strtoupper($grantee) === 'PUBLIC' ? 'PUBLIC' : $grantee) : throw new BadRequestException('Could not find the required parameter (grantee).');
    }

    private function schemaName(Connection $conn, int $scid): string
    {
        return (string) ($conn->scalar('SELECT nspname FROM pg_catalog.pg_namespace WHERE oid = $1', [$scid]) ?? throw new NotFoundException('Could not find the schema.'));
    }
}
