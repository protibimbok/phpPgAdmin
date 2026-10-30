<?php

declare(strict_types=1);

namespace PhpPgAdmin\Modules\Databases\Http\Controllers;

use League\Route\Http\Exception\BadRequestException;
use PhpPgAdmin\Core\Database\Connection;
use PhpPgAdmin\Core\Database\QueryException;
use PhpPgAdmin\Core\Database\Quoting;
use PhpPgAdmin\Core\Facades\Config;
use PhpPgAdmin\Core\Http\ApiException;
use PhpPgAdmin\Core\Nodes\Acl;
use PhpPgAdmin\Core\Nodes\Catalog;
use PhpPgAdmin\Core\Nodes\Ddl;
use PhpPgAdmin\Core\Nodes\NodeContext;
use PhpPgAdmin\Core\Nodes\NodeController;
use PhpPgAdmin\Core\Nodes\Options;

/**
 * The database node, after pgAdmin's DatabaseView: the databases of the server, their
 * properties with privileges, default privileges and settings, and the DDL that recreates one.
 */
final class DatabaseController extends NodeController
{
    /** pgAdmin's DATABASE_LAST_SYSTEM_OID: databases with lower OIDs are system objects. */
    public const int LAST_SYSTEM_OID = 16383;

    /** The ACL columns of the properties, each read by its own catalog query. */
    private const array ACL_COLUMNS = ['datacl', 'deftblacl', 'defseqacl', 'deffuncacl', 'deftypeacl'];

    /**
     * Every database the role may see, with the properties pgAdmin's list shows plus the
     * size, for the "Databases" page. The database the session landed in cannot be dropped.
     */
    public function list(NodeContext $ctx): array
    {
        $rows = [];
        $owner = $this->ownedOnly($ctx);
        foreach ($ctx->rows('properties.sql', ['last_system_oid' => $this->lastSystemOid($ctx)]) as $row) {
            $row['is_sys_obj'] = (int) $row['did'] <= self::LAST_SYSTEM_OID;
            if ($this->skip($ctx, $row) || ($owner !== null && $row['datowner'] !== $owner['rolname'])) {
                continue;
            }
            $row['can_drop'] = $row['name'] !== $ctx->conn->database();
            $rows[] = $row;
        }

        return $rows;
    }

    public function nodes(NodeContext $ctx): array
    {
        $nodes = [];
        $owner = $this->ownedOnly($ctx);
        foreach ($ctx->rows('nodes.sql', ['last_system_oid' => $this->lastSystemOid($ctx)]) as $row) {
            $row['is_sys_obj'] = (int) $row['did'] <= self::LAST_SYSTEM_OID;
            if (!$this->skip($ctx, $row) && ($owner === null || (int) $row['owner'] === (int) $owner['oid'])) {
                $nodes[] = $this->toNode($ctx, $row);
            }
        }

        return $nodes;
    }

    public function node(NodeContext $ctx, int $oid): array
    {
        $row = $ctx->row('nodes.sql', ['did' => $oid, 'last_system_oid' => 0]) ?? throw $this->gone($ctx);

        return $this->toNode($ctx, $row);
    }

    /**
     * The properties pgAdmin's dialog shows: the catalog row, the privileges and default
     * privileges grouped by column, the settings and the security labels. The default
     * privileges are per database, so they are read through a connection to it.
     */
    public function properties(NodeContext $ctx, int $oid): array
    {
        $row = $ctx->row('properties.sql', ['did' => $oid, 'last_system_oid' => 0]) ?? throw $this->gone($ctx);

        return $this->complete($ctx, $row, $oid, grantRevoke: false);
    }

    /**
     * CREATE DATABASE from the client's data (name, datowner, template, encoding, datcollate,
     * datctype, spcname, datconnlimit, is_template, comments), then the comment, settings and
     * privileges from grant.sql: pgAdmin's create. CREATE DATABASE cannot share a transaction
     * with other statements, so it runs on its own.
     */
    public function create(NodeContext $ctx, array $data): array
    {
        $name = $this->requireName($data);
        $data = $this->forCreate($ctx, $data);

        if (self::truthy($data['refresh_collation'] ?? false)) {
            $ctx->conn->query(self::refreshCollationSql($data));
        }

        try {
            $ctx->conn->query($ctx->render('create.sql', ['data' => $data]));
        } catch (QueryException $e) {
            throw $this->collationMismatch($ctx, $data, $e) ?? $e;
        }
        $this->execute($ctx, $ctx->render('grant.sql', ['data' => $data]));

        return $this->node($ctx, $this->oidOf($ctx, $name));
    }

    /**
     * Since 15, the server refuses a template whose recorded collation version (datcollversion)
     * is not the one the operating system now provides, as after a libc or ICU upgrade, and
     * tells the user to run ALTER DATABASE ... REFRESH COLLATION VERSION on it. When that is why
     * CREATE DATABASE failed, the failure is reported with that remedy, so the client can offer
     * to run it (which create() does when the data carries refresh_collation) and try again.
     *
     * @param array<string, mixed> $data
     */
    private function collationMismatch(NodeContext $ctx, array $data, QueryException $e): ?ApiException
    {
        if ($ctx->conn->version() < 150000) {
            return null;
        }
        // A database with a locale of its own is checked against that, not the template's.
        foreach (['datcollate', 'datctype', 'daticulocale', 'datbuiltinlocale', 'datlocaleprovider'] as $key) {
            if (isset($data[$key])) {
                return null;
            }
        }

        $template = self::templateOf($data);
        $row = $ctx->conn->row(
            'SELECT datcollversion AS recorded, pg_catalog.pg_database_collation_actual_version(oid) AS actual FROM pg_catalog.pg_database WHERE datname = $1',
            [$template],
        );
        if ($row === null || $row['recorded'] === null || $row['actual'] === null || $row['recorded'] === $row['actual']) {
            return null;
        }

        return new ApiException(409, $e->getMessage(), array_filter([
            'sqlstate' => $e->sqlstate,
            'detail' => $e->detail,
            'hint' => $e->hint,
            'remedy' => [
                'action' => 'refresh_collation',
                'template' => $template,
                'recorded' => $row['recorded'],
                'actual' => $row['actual'],
                'sql' => self::refreshCollationSql($data),
            ],
        ], static fn (mixed $v): bool => $v !== null));
    }

    /** @param array<string, mixed> $data */
    private static function templateOf(array $data): string
    {
        return trim((string) ($data['template'] ?? '')) !== '' ? (string) $data['template'] : 'template1';
    }

    /** @param array<string, mixed> $data */
    private static function refreshCollationSql(array $data): string
    {
        return sprintf('ALTER DATABASE %s REFRESH COLLATION VERSION;', Quoting::ident(self::templateOf($data)));
    }

    /**
     * ALTER DATABASE from the fields the client sends: the rename, owner, comment and connection
     * limit (alter_offline.sql), the tablespace (which cannot run inside a transaction, so on
     * its own), then the template flag, privileges, settings and labels (alter_online.sql) and
     * whether connections are allowed. Only what the data names is changed.
     */
    public function update(NodeContext $ctx, int $oid, array $data): array
    {
        $data = $this->forUpdate($ctx, $oid, $data);

        $this->execute($ctx, $ctx->render('alter_offline.sql', ['data' => $data, 'action' => 'rename_database']));
        $this->execute($ctx, $ctx->render('alter_offline.sql', ['data' => $data, 'action' => 'tablespace']));
        $this->execute($ctx, $this->onlineSql($ctx, $data));

        return $this->node($ctx, $oid);
    }

    /**
     * DROP DATABASE, WITH (FORCE) when the client asks for a cascade: pgAdmin's delete. The
     * database the session is connected to cannot be dropped from itself.
     */
    public function delete(NodeContext $ctx, int $oid, bool $cascade): void
    {
        $name = $ctx->conn->scalar($ctx->render('delete.sql', ['did' => $oid, 'datname' => null])) ?? throw $this->gone($ctx);
        if ($name === $ctx->conn->database()) {
            throw new BadRequestException(sprintf('The database "%s" is the one this session is connected to and cannot be dropped from here.', $name));
        }

        $ctx->conn->query($ctx->render('delete.sql', ['did' => null, 'datname' => $name, 'with_force' => $cascade]));
    }

    /** The statements create() or update() would run: pgAdmin's msql. */
    public function modifiedSql(NodeContext $ctx, ?int $oid, array $data): string
    {
        if ($oid === null) {
            $this->requireName($data);
            $data = $this->forCreate($ctx, $data);

            return Ddl::assemble([
                self::truthy($data['refresh_collation'] ?? false) ? self::refreshCollationSql($data) : '',
                $ctx->render('create.sql', ['data' => $data]),
                $ctx->render('grant.sql', ['data' => $data]),
            ]);
        }

        $data = $this->forUpdate($ctx, $oid, $data);

        return Ddl::assemble([
            $ctx->render('alter_offline.sql', ['data' => $data, 'action' => 'rename_database']),
            $ctx->render('alter_offline.sql', ['data' => $data, 'action' => 'tablespace']),
            $this->onlineSql($ctx, $data),
        ]);
    }

    /**
     * What the create and alter forms offer: the roles, tablespaces, encodings and the
     * databases a new one may be a copy of.
     *
     * The libc and ICU locales come from pg_collation, as suggestions for LC_COLLATE, LC_CTYPE
     * and ICU_LOCALE; the server version decides which locale providers the form offers.
     *
     * @return array{roles: list<string>, tablespaces: list<string>, encodings: list<string>, templates: list<string>, locales: list<string>, icu_locales: list<string>, version: int}
     */
    public function options(NodeContext $ctx): array
    {
        $version = $ctx->version();
        $icuColumn = $version >= 170000 ? 'colllocale' : 'colliculocale';

        return [
            'roles' => Catalog::roles($ctx->conn),
            'tablespaces' => Catalog::tablespaces($ctx->conn),
            'encodings' => Catalog::encodings($ctx->conn),
            'templates' => Catalog::databases($ctx->conn),
            'locales' => array_map('strval', array_column($ctx->conn->rows("SELECT DISTINCT collcollate FROM pg_catalog.pg_collation WHERE collprovider = 'c' AND collcollate IS NOT NULL AND collencoding IN (-1, pg_catalog.pg_char_to_encoding(pg_catalog.getdatabaseencoding())) ORDER BY 1"), 'collcollate')),
            'icu_locales' => $version < 150000 ? [] : array_map('strval', array_column($ctx->conn->rows("SELECT DISTINCT {$icuColumn} AS locale FROM pg_catalog.pg_collation WHERE collprovider = 'i' AND {$icuColumn} IS NOT NULL ORDER BY 1"), 'locale')),
            'version' => $version,
        ];
    }

    /**
     * The DDL that recreates the database: pgAdmin's header and commented DROP, the CREATE from
     * create.sql, then the comment, settings, privileges and default privileges from grant.sql.
     */
    public function sql(NodeContext $ctx, int $oid): string
    {
        $row = $ctx->row('properties.sql', ['did' => $oid, 'last_system_oid' => 0]) ?? throw $this->gone($ctx);
        $data = $this->complete($ctx, $row, $oid, grantRevoke: true);

        // delete.sql also looks the name up when "did" is set; here the name is known.
        $header = Ddl::header('Database', $data['name'], $ctx->render('delete.sql', ['did' => null, 'datname' => $data['name']]));

        return Ddl::assemble([$header, $this->createSql($ctx, $data)]);
    }

    public function statistics(NodeContext $ctx, ?int $oid): array
    {
        $result = $ctx->query('stats.sql', ['did' => $oid, 'last_system_oid' => $this->lastSystemOid($ctx)]);

        return [
            'columns' => array_map(static fn ($c): array => ['name' => $c->name, 'type' => $c->typeName], $result->columns()),
            'rows' => $result->rows(),
        ];
    }

    /** A database by name: resolve('database', {name}) → {did}. */
    public function resolve(NodeContext $ctx, array $params): ?array
    {
        $name = (string) ($params['name'] ?? '');
        if ($name === '') {
            return null;
        }

        $oid = $ctx->conn->scalar('SELECT oid FROM pg_catalog.pg_database WHERE datname = $1', [$name]);

        return $oid === null ? null : ['did' => (int) $oid];
    }

    /**
     * CREATE DATABASE plus the statements that cannot share its transaction (grant.sql), with
     * the ACL columns turned into template rows per allowed_privs.json: pgAdmin's get_new_sql.
     *
     * @param array<string, mixed> $data
     */
    private function createSql(NodeContext $ctx, array $data): string
    {
        /** @var array<string, array{type: string, acl: list<string>}> $allowed */
        $allowed = json_decode($ctx->render('allowed_privs.json'), true, flags: JSON_THROW_ON_ERROR);

        foreach ($allowed as $column => $spec) {
            if (isset($data[$column]) && is_array($data[$column])) {
                $data[$column] = Acl::toDb($data[$column], $spec['acl']);
            }
        }

        // Jinja prints a boolean as True/False where Twig prints 1 or nothing; the template writes it out.
        $data['is_template'] = ($data['is_template'] ?? false) ? 'true' : 'false';

        return Ddl::assemble([$ctx->render('create.sql', ['data' => $data]), $ctx->render('grant.sql', ['data' => $data])]);
    }

    /**
     * The client's data as create.sql and grant.sql take it: privileges as template rows, the
     * template flag spelled out, empty optional fields dropped.
     *
     * @param array<string, mixed> $data
     * @return array<string, mixed>
     */
    private function forCreate(NodeContext $ctx, array $data): array
    {
        foreach (['datowner', 'template', 'encoding', 'datcollate', 'datctype', 'spcname', 'datlocaleprovider', 'daticulocale', 'datbuiltinlocale', 'datstrategy'] as $key) {
            if (isset($data[$key]) && trim((string) $data[$key]) === '') {
                unset($data[$key]);
            }
        }
        if (isset($data['datconnlimit']) && (string) $data['datconnlimit'] === '') {
            unset($data['datconnlimit']);
        }
        $data['is_template'] = self::truthy($data['is_template'] ?? false) ? 'true' : 'false';

        return $this->aclToDb($ctx, $data, modified: false);
    }

    /**
     * The client's data as the alter templates take it: the current name as old_name (and as the
     * name when none is given), booleans spelled out, privileges as template rows.
     *
     * @param array<string, mixed> $data
     * @return array<string, mixed>
     */
    private function forUpdate(NodeContext $ctx, int $oid, array $data): array
    {
        $row = $ctx->row('nodes.sql', ['did' => $oid, 'last_system_oid' => 0]) ?? throw $this->gone($ctx);
        $data['old_name'] = $row['name'];
        if (!isset($data['name']) || trim((string) $data['name']) === '') {
            $data['name'] = $row['name'];
        }
        if (array_key_exists('is_template', $data)) {
            $data['is_template'] = self::truthy($data['is_template']) ? 'true' : 'false';
        }
        if (isset($data['datconnlimit']) && (string) $data['datconnlimit'] === '') {
            unset($data['datconnlimit']);
        }

        return $this->aclToDb($ctx, $data, modified: true);
    }

    /**
     * alter_online.sql plus what pgAdmin's templates leave out: the connection limit of 0 (which
     * the template treats as unset) and whether connections are allowed.
     *
     * @param array<string, mixed> $data
     */
    private function onlineSql(NodeContext $ctx, array $data): string
    {
        $parts = [$ctx->render('alter_online.sql', ['data' => $data])];
        $name = Quoting::ident((string) $data['name']);

        if (array_key_exists('datconnlimit', $data) && (int) $data['datconnlimit'] === 0) {
            $parts[] = sprintf('ALTER DATABASE %s WITH CONNECTION LIMIT = 0;', $name);
        }
        if (array_key_exists('datallowconn', $data)) {
            $parts[] = sprintf('ALTER DATABASE %s WITH ALLOW_CONNECTIONS = %s;', $name, self::truthy($data['datallowconn']) ? 'true' : 'false');
        }

        return Ddl::assemble($parts);
    }

    /**
     * The ACL columns of the data turned into template rows per allowed_privs.json: pgAdmin's
     * format_request_acls, for the whole lists (create) or the added/changed/deleted parts (alter).
     *
     * @param array<string, mixed> $data
     * @return array<string, mixed>
     */
    private function aclToDb(NodeContext $ctx, array $data, bool $modified): array
    {
        /** @var array<string, array{type: string, acl: list<string>}> $allowed */
        $allowed = json_decode($ctx->render('allowed_privs.json'), true, flags: JSON_THROW_ON_ERROR);

        foreach ($allowed as $column => $spec) {
            if (!isset($data[$column]) || !is_array($data[$column])) {
                continue;
            }
            if (!$modified) {
                $data[$column] = Acl::toDb($data[$column], $spec['acl']);
                continue;
            }
            foreach (['added', 'changed', 'deleted'] as $mode) {
                if (isset($data[$column][$mode]) && is_array($data[$column][$mode])) {
                    $data[$column][$mode] = Acl::toDb($data[$column][$mode], $spec['acl']);
                }
            }
        }

        return $data;
    }

    private function oidOf(NodeContext $ctx, string $name): int
    {
        return (int) ($ctx->conn->scalar('SELECT oid FROM pg_catalog.pg_database WHERE datname = $1', [$name]) ?? throw $this->gone($ctx));
    }

    private static function truthy(mixed $value): bool
    {
        return $value === true || $value === 1 || $value === '1' || $value === 'true' || $value === 'on';
    }

    /**
     * Add to a properties row what pgAdmin's formatdbacl and the variable/label parsers add.
     *
     * @param array<string, mixed> $row
     * @return array<string, mixed>
     */
    private function complete(NodeContext $ctx, array $row, int $oid, bool $grantRevoke): array
    {
        $own = $this->connectionTo($ctx, (string) $row['name']);

        foreach ($ctx->conn->rows($ctx->render('acl.sql', ['did' => $oid])) as $acl) {
            $row[$acl['deftype']][] = Acl::fromDb($acl);
        }

        // Default privileges live in the database itself; the maintenance connection sees only its own.
        if ($own !== null) {
            foreach ($own->rows($ctx->render('defacl.sql', ['did' => $oid, 'grant_reovke_sql' => $grantRevoke])) as $acl) {
                $row[$acl['deftype']][] = Acl::fromDb($acl);
            }
        }

        foreach (self::ACL_COLUMNS as $column) {
            $row[$column] ??= [];
        }

        $row['is_sys_obj'] = (int) $row['oid'] <= self::LAST_SYSTEM_OID;
        $row['variables'] = Options::parseVariables($ctx->conn->rows($ctx->render('get_variables.sql', ['did' => $oid])));
        $row['seclabels'] = Options::parseSecurityLabels($row['seclabels'] ?? null);

        return $row;
    }

    /** A connection to the database itself, or null when the role may not open one. */
    private function connectionTo(NodeContext $ctx, string $name): ?Connection
    {
        if ($name === $ctx->conn->database()) {
            return $ctx->conn;
        }

        try {
            return $ctx->pool->for($name);
        } catch (\PhpPgAdmin\Core\Database\ConnectionException) {
            return null;
        }
    }

    /** pgAdmin hides system databases and templates unless asked to; "postgres" always shows. */
    private function lastSystemOid(NodeContext $ctx): int
    {
        return $ctx->flag('system_objects') ? 0 : self::LAST_SYSTEM_OID;
    }

    /**
     * The signed-in role when only the databases it owns are listed (the classic phpPgAdmin's
     * owned_only, config auth.owned_only); null when every database is, as for a superuser.
     *
     * @return array{oid: int|string, rolname: string}|null
     */
    private function ownedOnly(NodeContext $ctx): ?array
    {
        if (!(bool) Config::get('auth.owned_only', false)) {
            return null;
        }

        $role = $ctx->conn->row('SELECT oid, rolname, rolsuper FROM pg_catalog.pg_roles WHERE rolname = current_user');

        return $role === null || $role['rolsuper'] ? null : ['oid' => $role['oid'], 'rolname' => (string) $role['rolname']];
    }

    /** @param array<string, mixed> $row */
    private function skip(NodeContext $ctx, array $row): bool
    {
        if (in_array($row['name'], ['postgres', 'edb'], true)) {
            return false;
        }

        $showSystem = $ctx->flag('system_objects');
        $showTemplates = $ctx->flag('templates');

        if ((!$showSystem || !$showTemplates) && $row['is_sys_obj']) {
            return true;
        }

        return !$showTemplates && $row['is_template'] && !$row['is_sys_obj'];
    }

    protected function toNode(NodeContext $ctx, array $row): array
    {
        $node = parent::toNode($ctx, ['oid' => $row['did'], ...$row]);
        $node['inode'] = (bool) ($row['datallowconn'] ?? true);

        return $node;
    }

    protected function icon(NodeContext $ctx, array $row): string
    {
        return ($row['is_template'] ?? false) ? 's_db' : 's_db';
    }
}
