<?php

declare(strict_types=1);

namespace PhpPgAdmin\Modules\Tables\Ddl;

use League\Route\Http\Exception\BadRequestException;
use League\Route\Http\Exception\GoneException;
use PhpPgAdmin\Core\Nodes\Ddl;
use PhpPgAdmin\Core\Nodes\NodeContext;
use PhpPgAdmin\Core\Nodes\Options;
use PhpPgAdmin\Modules\Databases\Http\Controllers\DatabaseController;

/**
 * The statements that create, alter and drop an index: pgAdmin's indexes/utils.py get_sql on
 * indexes/create.sql, alter.sql, update.sql and delete.sql.
 *
 * An index from the client carries pgAdmin's field names: name, amname, indisunique,
 * isconcurrent, indnullsnotdistinct, columns [{colname, is_exp, sort_order (DESC when true),
 * nulls (FIRST when true), collspcname, op_class}], include [names], indconstraint (the WHERE),
 * fillfactor and the other storage parameters, spcname, description, indisclustered.
 */
final class IndexSql
{
    private const array STORAGE_PARAMETERS = ['fillfactor', 'deduplicate_items', 'gin_pending_list_limit', 'pages_per_range', 'buffering', 'fastupdate', 'autosummarize', 'lists'];

    /** The fields whose change means the index has to be made anew; the others are ALTER INDEX. */
    private const array DEFINITION_FIELDS = ['amname', 'indisunique', 'indnullsnotdistinct', 'indconstraint', 'include'];

    /**
     * CREATE INDEX from the client's data, then its comment and CLUSTER ON. The two halves are
     * returned apart because CREATE INDEX CONCURRENTLY cannot share a transaction.
     *
     * @return array{0: string, 1: string}
     */
    public static function createParts(NodeContext $ctx, string $schema, string $table, array $data): array
    {
        $data = self::forTemplate($data);
        if (($data['columns'] ?? []) === []) {
            throw new BadRequestException('An index needs at least one column.');
        }
        $data['schema'] = $schema;
        $data['table'] = $table;
        $data['name'] = trim((string) ($data['name'] ?? '')) ?: null;

        return [
            $ctx->renderFrom('indexes', 'create.sql', ['data' => $data, 'mode' => 'create', 'add_not_exists_clause' => false]),
            $ctx->renderFrom('indexes', 'alter.sql', ['data' => $data]),
        ];
    }

    public static function createSql(NodeContext $ctx, string $schema, string $table, array $data): string
    {
        return Ddl::assemble(self::createParts($ctx, $schema, $table, $data));
    }

    /**
     * The statements that take the index from what it is to what the client sent: ALTER INDEX
     * for a rename, storage parameter, tablespace, comment or CLUSTER change; DROP and CREATE
     * when its columns or definition changed, which PostgreSQL cannot alter in place.
     *
     * @return array{sql: string, recreated: bool}
     */
    public static function updateSql(NodeContext $ctx, int $tid, string $schema, string $table, int $idx, array $data): array
    {
        $old = self::current($ctx, $tid, $idx);
        $old['schema'] = $schema;
        $old['table'] = $table;
        // A rename or comment change comes without columns; only a redefinition names them.
        $data = self::forTemplate(array_key_exists('columns', $data) ? $data : [...$data, 'amname' => $old['amname']]);
        if (!array_key_exists('columns', $data)) {
            unset($data['columns']);
        }
        $data['schema'] = $schema;
        $data['table'] = $table;
        if (!isset($data['name']) || trim((string) $data['name']) === '') {
            $data['name'] = $old['name'];
        }

        if (self::redefined($data, $old)) {
            $new = [...$old, ...$data];
            unset($new['dependsonextensions']);

            return ['sql' => Ddl::assemble([self::deleteSql($ctx, $schema, (string) $old['name'], false), self::createSql($ctx, $schema, $table, $new)]), 'recreated' => true];
        }

        return ['sql' => $ctx->renderFrom('indexes', 'update.sql', ['data' => $data, 'o_data' => $old, 'update_column' => false, 'update_column_data' => []]), 'recreated' => false];
    }

    public static function deleteSql(NodeContext $ctx, string $schema, string $name, bool $cascade): string
    {
        return $ctx->renderFrom('indexes', 'delete.sql', ['data' => ['nspname' => $schema, 'name' => $name], 'cascade' => $cascade]);
    }

    /**
     * The index as it stands, with its columns as the templates and the dialog take them.
     *
     * @return array<string, mixed>
     */
    public static function current(NodeContext $ctx, int $tid, int $idx): array
    {
        $old = $ctx->conn->row($ctx->renderFrom('indexes', 'properties.sql', ['tid' => $tid, 'idx' => $idx, 'datlastsysoid' => DatabaseController::LAST_SYSTEM_OID, 'show_sys_objects' => true]))
            ?? throw new GoneException('Could not find the index in the table.');
        $old['columns'] = IndexDdl::columns($ctx, $idx, (string) $old['amname']);
        $old['include'] = IndexDdl::include($ctx, $idx);
        $old['dependsonextensions'] = Options::list($old['dependsonextensions'] ?? null);

        return $old;
    }

    /**
     * The client's index as create.sql takes it: the storage parameters gathered, every column
     * told whether its order matters (btree only), empty optional fields dropped.
     *
     * @param array<string, mixed> $data
     * @return array<string, mixed>
     */
    private static function forTemplate(array $data): array
    {
        $amname = (string) ($data['amname'] ?? 'btree');
        $data['amname'] = $amname;
        $data['storage_parameters'] = [];
        foreach (self::STORAGE_PARAMETERS as $param) {
            if (isset($data[$param]) && $data[$param] !== '' && $data[$param] !== null) {
                $data['storage_parameters'][$param] = is_bool($data[$param]) ? ($data[$param] ? 'true' : 'false') : $data[$param];
            }
        }
        foreach (['indconstraint', 'spcname', 'description'] as $key) {
            if (isset($data[$key]) && trim((string) $data[$key]) === '') {
                unset($data[$key]);
            }
        }
        $data['include'] = array_values(array_filter((array) ($data['include'] ?? []), static fn ($c): bool => trim((string) $c) !== ''));
        $data['dependsonextensions'] ??= [];

        if (!array_key_exists('columns', $data)) {
            return $data;
        }
        $columns = [];
        foreach ((array) $data['columns'] as $column) {
            if (trim((string) ($column['colname'] ?? '')) === '') {
                continue;
            }
            $column['is_exp'] = (bool) ($column['is_exp'] ?? false);
            $column['is_sort_nulls_applicable'] = $amname === 'btree';
            if (array_key_exists('sort_order', $column)) {
                $column['sort_order'] = (bool) $column['sort_order'];
            }
            if (array_key_exists('nulls', $column)) {
                $column['nulls'] = (bool) $column['nulls'];
            }
            $columns[] = $column;
        }
        $data['columns'] = $columns;

        return $data;
    }

    /**
     * Whether the client changed what only DROP and CREATE can change: the columns, their
     * order, the access method, uniqueness, the WHERE or the INCLUDE list.
     *
     * @param array<string, mixed> $data
     * @param array<string, mixed> $old
     */
    private static function redefined(array $data, array $old): bool
    {
        if (isset($data['columns'])) {
            $shape = static fn (array $c): string => implode('|', [
                (string) ($c['colname'] ?? ''),
                !empty($c['sort_order']) ? 'DESC' : 'ASC',
                !empty($c['nulls']) ? 'FIRST' : 'LAST',
                (string) ($c['collspcname'] ?? ''),
                (string) ($c['op_class'] ?? ''),
            ]);
            if (array_map($shape, $data['columns']) !== array_map($shape, $old['columns'])) {
                return true;
            }
        }
        foreach (self::DEFINITION_FIELDS as $field) {
            if (!array_key_exists($field, $data)) {
                continue;
            }
            $new = $data[$field];
            $was = $old[$field] ?? null;
            if ($field === 'include') {
                if (array_values((array) $new) !== array_values((array) $was)) {
                    return true;
                }
                continue;
            }
            if (is_bool($new) || is_bool($was)) {
                if ((bool) $new !== (bool) $was) {
                    return true;
                }
                continue;
            }
            if ((string) ($new ?? '') !== (string) ($was ?? '')) {
                return true;
            }
        }

        return false;
    }
}
