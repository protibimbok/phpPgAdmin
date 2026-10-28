<?php

declare(strict_types=1);

namespace PhpPgAdmin\Modules\Roles\Http\Controllers;

use League\Route\Http\Exception\BadRequestException;
use PhpPgAdmin\Core\Database\ConnectionException;
use PhpPgAdmin\Core\Database\Quoting;
use PhpPgAdmin\Core\Nodes\Acl;
use PhpPgAdmin\Core\Nodes\Catalog;
use PhpPgAdmin\Core\Nodes\Ddl;
use PhpPgAdmin\Core\Nodes\NodeContext;
use PhpPgAdmin\Core\Nodes\NodeController;
use PhpPgAdmin\Core\Nodes\Options;
use PhpPgAdmin\Modules\Databases\Http\Controllers\DatabaseController;

/**
 * The tablespace node, after pgAdmin's TablespaceView: the tablespaces with their location,
 * owner, options and size, the statements that create, alter and drop one, what is stored in
 * one across the databases, and pgAdmin's "Move objects" (ALTER ... ALL IN TABLESPACE).
 *
 * The client's data carries pgAdmin's field names: name, spcuser, spclocation, description and
 * spcoptions ([{name, value}]). An update takes the whole form; what differs from the
 * tablespace as it stands is what changes. Privileges are edited one grantee at a time through
 * PrivilegeController, as on the other Privileges pages.
 */
final class TablespaceController extends NodeController
{
    /** The kinds of object ALTER ... ALL IN TABLESPACE moves, by the keyword it takes. */
    private const array MOVABLE = ['tables' => 'TABLE', 'indexes' => 'INDEX', 'materialized_views' => 'MATERIALIZED VIEW'];

    /** pg_class.relkind → the type pgAdmin's get_dependents reports; indexes are named "index ON table". */
    private const array DEPENDENT_KINDS = ['r' => 'table', 'p' => 'table', 'i' => 'index', 'I' => 'index', 'S' => 'sequence', 'm' => 'mview', 't' => 'toast table'];

    /** Every tablespace with its properties, size and privileges. */
    public function list(NodeContext $ctx): array
    {
        $sizes = array_column($ctx->conn->rows('SELECT oid, pg_catalog.pg_tablespace_size(oid) AS size FROM pg_catalog.pg_tablespace'), 'size', 'oid');

        return array_map(fn (array $row): array => [...$this->transform($row), 'size' => isset($sizes[$row['oid']]) ? (int) $sizes[$row['oid']] : null], $ctx->rows('properties.sql'));
    }

    public function properties(NodeContext $ctx, int $oid): array
    {
        $row = $this->transform($ctx->row('properties.sql', ['tsid' => $oid]) ?? throw $this->gone($ctx));
        $row['size'] = (int) $ctx->conn->scalar('SELECT pg_catalog.pg_tablespace_size($1::oid)', [$oid]);

        return $row;
    }

    /** pgAdmin's sql(): the header, CREATE TABLESPACE (not for pg_default and pg_global), then alter.sql. */
    public function sql(NodeContext $ctx, int $oid): string
    {
        $data = $this->transform($ctx->row('properties.sql', ['tsid' => $oid]) ?? throw $this->gone($ctx));
        $data['spcacl'] = Acl::toDb(Acl::allFromDb($ctx->rows('acl.sql', ['tsid' => $oid])), ['C']);

        return Ddl::assemble([
            Ddl::header('Tablespace', $data['name'], $ctx->render('delete.sql', ['tsname' => $data['name']])),
            str_starts_with($data['name'], 'pg_') ? '' : $ctx->render('create.sql', ['data' => $data]),
            $ctx->render('alter.sql', ['data' => $data]),
        ]);
    }

    /**
     * CREATE TABLESPACE, which may not run inside a transaction block, then the comment and
     * options from alter.sql as a batch of their own.
     */
    public function create(NodeContext $ctx, array $data): array
    {
        $data = $this->forCreate($data);
        $ctx->conn->query(trim($ctx->render('create.sql', ['data' => $data])));
        $this->execute($ctx, $ctx->render('alter.sql', ['data' => [...$data, 'spcuser' => null]]));

        $oid = $ctx->conn->scalar($ctx->render('alter.sql', ['tablespace' => $data['name']])) ?? throw $this->gone($ctx);

        return $this->node($ctx, (int) $oid);
    }

    public function update(NodeContext $ctx, int $oid, array $data): array
    {
        $this->execute($ctx, $this->updateSql($ctx, $oid, $data));

        return $this->node($ctx, $oid);
    }

    /** DROP TABLESPACE; it must be empty in every database first. */
    public function delete(NodeContext $ctx, int $oid, bool $cascade): void
    {
        $name = (string) ($ctx->row('nodes.sql', ['tsid' => $oid])['name'] ?? throw $this->gone($ctx));
        $ctx->conn->query(trim($ctx->render('delete.sql', ['tsname' => $name])));
    }

    public function modifiedSql(NodeContext $ctx, ?int $oid, array $data): string
    {
        if ($oid === null) {
            $data = $this->forCreate($data);

            return Ddl::assemble([$ctx->render('create.sql', ['data' => $data]), $ctx->render('alter.sql', ['data' => [...$data, 'spcuser' => null]])]);
        }

        return Ddl::assemble([$this->updateSql($ctx, $oid, $data)]);
    }

    public function statistics(NodeContext $ctx, ?int $oid): array
    {
        $result = $ctx->query('stats.sql', ['tsid' => $oid]);

        return [
            'columns' => array_map(static fn ($c): array => ['name' => $c->name, 'type' => $c->typeName], $result->columns()),
            'rows' => $result->rows(),
        ];
    }

    /** Nothing a tablespace depends on is recorded in pg_shdepend beyond its owner. */
    public function dependencies(NodeContext $ctx, int $oid): array
    {
        return [];
    }

    /**
     * pgAdmin's get_dependents: the databases whose default tablespace it is, then in each
     * database the session may connect to the relations stored in it (those with reltablespace 0
     * when it is that database's default).
     */
    public function dependents(NodeContext $ctx, int $oid): array
    {
        $dependents = [];
        foreach ($ctx->rows('dependents.sql', ['fetch_database' => true]) as $database) {
            if ((int) $database['dattablespace'] === $oid) {
                $dependents[] = ['type' => 'database', 'name' => $database['datname'], 'field' => $database['datname'], 'icon' => 's_db'];
            }
            if (!$database['datallowconn']) {
                continue;
            }
            try {
                $conn = $database['datname'] === $ctx->conn->database() ? $ctx->conn : $ctx->pool->for($database['datname']);
            } catch (ConnectionException) {
                continue;
            }
            foreach ($conn->rows($ctx->render('dependents.sql', ['fetch_dependents' => true, 'tsid' => $oid])) as $row) {
                $type = self::DEPENDENT_KINDS[$row['relkind']] ?? null;
                if ($type === null) {
                    continue;
                }
                $name = $row['nspname'] . '.' . $row['relname'];
                $dependents[] = [
                    'type' => $type,
                    'name' => $type === 'index' ? $row['indname'] . ' ON ' . $name : $name,
                    'field' => $database['datname'],
                    'icon' => null,
                ];
            }
        }

        return $dependents;
    }

    /** A tablespace by name: resolve('tablespace', {name}) → {tsid}. */
    public function resolve(NodeContext $ctx, array $params): ?array
    {
        $oid = $ctx->conn->scalar('SELECT oid FROM pg_catalog.pg_tablespace WHERE spcname = $1', [(string) ($params['name'] ?? '')]);

        return $oid === null ? null : ['tsid' => (int) $oid];
    }

    /**
     * What the forms offer: the owners, the options a tablespace may set (pgAdmin's vopts), the
     * databases objects may be moved in and the other tablespaces they may be moved to.
     *
     * @return array{roles: list<string>, variables: list<array<string, mixed>>, databases: list<string>, tablespaces: list<string>}
     */
    public function options(NodeContext $ctx): array
    {
        return [
            'roles' => Catalog::roles($ctx->conn),
            'variables' => $ctx->rows('variables.sql'),
            'databases' => array_column($ctx->conn->rows("SELECT datname FROM pg_catalog.pg_database WHERE datallowconn AND pg_catalog.has_database_privilege(datname, 'CONNECT') ORDER BY datname"), 'datname'),
            'tablespaces' => Catalog::tablespaces($ctx->conn),
        ];
    }

    /**
     * pgAdmin's "Move objects": ALTER TABLE / INDEX / MATERIALIZED VIEW ALL IN TABLESPACE the
     * tablespace [OWNED BY …] SET TABLESPACE another [NOWAIT], for each kind chosen. The
     * statements act on the database they run in, so they go through a connection to it.
     *
     * @param array{database?: string, kinds?: list<string>, tablespace?: string, owned_by?: list<string>, nowait?: bool} $data
     */
    public function move(NodeContext $ctx, int $oid, array $data, bool $run): string
    {
        $name = (string) ($ctx->row('nodes.sql', ['tsid' => $oid])['name'] ?? throw $this->gone($ctx));
        $database = trim((string) ($data['database'] ?? ''));
        $target = trim((string) ($data['tablespace'] ?? ''));
        if ($database === '' || $target === '') {
            throw new BadRequestException('A database and the tablespace to move the objects to are required.');
        }
        if ($target === $name) {
            throw new BadRequestException('Choose another tablespace to move the objects to.');
        }
        $kinds = array_values(array_intersect(array_keys(self::MOVABLE), is_array($data['kinds'] ?? null) ? $data['kinds'] : []));
        if ($kinds === []) {
            throw new BadRequestException('Choose the kinds of object to move.');
        }
        $owners = array_values(array_filter(array_map(static fn (mixed $role): string => trim((string) $role), is_array($data['owned_by'] ?? null) ? $data['owned_by'] : []), static fn (string $role): bool => $role !== ''));

        $sql = Ddl::assemble(array_map(static fn (string $kind): string => sprintf(
            'ALTER %s ALL IN TABLESPACE %s%s%s SET TABLESPACE %s%s;',
            self::MOVABLE[$kind],
            Quoting::ident($name),
            $owners === [] ? '' : ' OWNED BY ',
            implode(', ', array_map(Quoting::ident(...), $owners)),
            Quoting::ident($target),
            ($data['nowait'] ?? false) === true ? ' NOWAIT' : '',
        ), $kinds));

        if ($run) {
            try {
                $ctx->pool->for($database)->queryMulti($sql);
            } catch (ConnectionException $e) {
                throw new BadRequestException($e->getMessage());
            }
        }

        return $sql;
    }

    /**
     * pgAdmin's _formatter: the options as [{name, value}] and the labels as objects.
     *
     * @param array<string, mixed> $row
     * @return array<string, mixed>
     */
    private function transform(array $row): array
    {
        $row['oid'] = (int) $row['oid'];
        $row['spcoptions'] = array_map(static function (string $option): array {
            [$name, $value] = array_pad(explode('=', $option, 2), 2, '');

            return ['name' => $name, 'value' => $value];
        }, Options::list($row['spcoptions'] ?? null));
        $row['seclabels'] = Options::parseSecurityLabels($row['seclabels'] ?? null);
        $row['is_sys_obj'] = $row['oid'] <= DatabaseController::LAST_SYSTEM_OID;

        return $row;
    }

    /**
     * The client's data as create.sql and alter.sql take it.
     *
     * @param array<string, mixed> $data
     * @return array<string, mixed>
     */
    private function forCreate(array $data): array
    {
        $data['name'] = $this->requireName($data);
        if (!array_key_exists('spclocation', $data) || $data['spclocation'] === null) {
            throw new BadRequestException('Could not find the required parameter (spclocation).');
        }
        $data['spclocation'] = trim((string) $data['spclocation']);
        $data['spcuser'] = self::blankToNull($data['spcuser'] ?? null);
        $data['description'] = self::blankToNull($data['description'] ?? null);
        $data['spcoptions'] = self::optionList($data['spcoptions'] ?? []);
        unset($data['spcacl'], $data['seclabels']);

        return $data;
    }

    /**
     * update.sql for what the form changes against the tablespace as it stands: the rename,
     * owner, comment and the options as added, changed and deleted lists.
     *
     * @param array<string, mixed> $data
     */
    private function updateSql(NodeContext $ctx, int $oid, array $data): string
    {
        $old = $this->transform($ctx->row('properties.sql', ['tsid' => $oid]) ?? throw $this->gone($ctx));
        $changes = ['name' => trim((string) ($data['name'] ?? '')) ?: $old['name']];

        $owner = self::blankToNull($data['spcuser'] ?? null);
        if ($owner !== null && $owner !== $old['spcuser']) {
            $changes['spcuser'] = $owner;
        }
        if (array_key_exists('description', $data) && (string) $data['description'] !== (string) ($old['description'] ?? '')) {
            $changes['description'] = (string) $data['description'];
        }
        if (isset($data['spcoptions']) && is_array($data['spcoptions'])) {
            $new = array_column(self::optionList($data['spcoptions']), 'value', 'name');
            $was = array_column($old['spcoptions'], 'value', 'name');
            $options = [
                'added' => self::pairs(array_diff_key($new, $was)),
                'changed' => self::pairs(array_filter(array_intersect_key($new, $was), static fn (string $value, string $name): bool => $value !== $was[$name], ARRAY_FILTER_USE_BOTH)),
                'deleted' => self::pairs(array_diff_key($was, $new)),
            ];
            if ($options !== ['added' => [], 'changed' => [], 'deleted' => []]) {
                $changes['spcoptions'] = $options;
            }
        }

        return $ctx->render('update.sql', ['data' => $changes, 'o_data' => $old]);
    }

    /**
     * The options the client sends, one per name. VARIABLE.SET writes the value unquoted, as the
     * options are all numbers, so anything else is turned down here.
     *
     * @return list<array{name: string, value: string}>
     */
    private static function optionList(mixed $options): array
    {
        $list = [];
        foreach (is_array($options) ? $options : [] as $option) {
            $name = trim((string) ($option['name'] ?? ''));
            $value = trim((string) ($option['value'] ?? ''));
            if ($name === '') {
                continue;
            }
            if (!is_numeric($value)) {
                throw new BadRequestException(sprintf('The value of "%s" must be a number.', $name));
            }
            $list[$name] = ['name' => $name, 'value' => $value];
        }

        return array_values($list);
    }

    /**
     * @param array<string, string> $options
     * @return list<array{name: string, value: string}>
     */
    private static function pairs(array $options): array
    {
        return array_map(static fn (string $name, string $value): array => ['name' => $name, 'value' => $value], array_keys($options), array_values($options));
    }

    private static function blankToNull(mixed $value): ?string
    {
        return $value === null || trim((string) $value) === '' ? null : (string) $value;
    }

    protected function icon(NodeContext $ctx, array $row): string
    {
        return 'b_tblops';
    }
}
