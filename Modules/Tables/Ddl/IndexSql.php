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

    /** The storage parameters that take on/off; the templates print them as true and false. */
    private const array BOOLEAN_PARAMETERS = ['deduplicate_items', 'fastupdate', 'autosummarize'];

    /** The values buffering (GiST) takes. */
    private const array BUFFERING = ['auto', 'on', 'off'];

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
            // The storage parameters are the client's: one it left out is reset, and the old
            // method's (fastupdate of a GIN index made BRIN) cannot carry over.
            foreach (self::STORAGE_PARAMETERS as $param) {
                if (!array_key_exists($param, $data)) {
                    unset($new[$param]);
                }
            }

            return ['sql' => Ddl::assemble([self::deleteSql($ctx, $schema, (string) $old['name'], false), self::createSql($ctx, $schema, $table, $new)]), 'recreated' => true];
        }

        // update.sql compares and prints the on/off parameters as they stand: both sides as true and false.
        foreach (self::BOOLEAN_PARAMETERS as $param) {
            if (is_bool($old[$param] ?? null)) {
                $old[$param] = $old[$param] ? 'true' : 'false';
            }
        }
        // A storage parameter the client left out keeps its value; update.sql would read it as
        // emptied and RESET it. Only one sent empty is reset.
        foreach (self::STORAGE_PARAMETERS as $param) {
            if (!array_key_exists($param, $data)) {
                $data[$param] = $old[$param] ?? null;
            }
        }

        $statistics = self::statisticsChanges($data, $old);

        return ['sql' => $ctx->renderFrom('indexes', 'update.sql', ['data' => $data, 'o_data' => $old, 'update_column' => $statistics !== [], 'update_column_data' => $statistics]), 'recreated' => false];
    }

    /**
     * pgAdmin's per-column statistics target of an index: ALTER INDEX … ALTER COLUMN n SET
     * STATISTICS for each expression column whose "statistics" the client changed (-1 for the
     * default). PostgreSQL takes it only on expression columns.
     *
     * @param array<string, mixed> $data
     * @param array<string, mixed> $old
     * @return list<array{col_num: int, statistics: int}>
     */
    private static function statisticsChanges(array $data, array $old): array
    {
        $changes = [];
        foreach (array_values((array) ($data['columns'] ?? [])) as $i => $column) {
            if (!is_array($column) || !array_key_exists('statistics', $column) || $column['statistics'] === null || $column['statistics'] === '') {
                continue;
            }
            $was = $old['columns'][$i] ?? null;
            if (!is_array($was) || empty($was['is_exp'])) {
                continue;
            }
            $value = filter_var($column['statistics'], FILTER_VALIDATE_INT, ['options' => ['min_range' => -1, 'max_range' => 10000]]);
            if ($value === false) {
                throw new BadRequestException('A statistics target is a whole number from -1 (the default) to 10000.');
            }
            $current = $was['statistics'] === null ? -1 : (int) $was['statistics'];
            if ($value !== $current) {
                $changes[] = ['col_num' => (int) $was['col_num'], 'statistics' => $value];
            }
        }

        return $changes;
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
        $old['columns'] = array_map(self::asEdited(...), IndexDdl::columns($ctx, $idx, (string) $old['amname']));
        $old['include'] = IndexDdl::include($ctx, $idx);
        $old['dependsonextensions'] = Options::list($old['dependsonextensions'] ?? null);

        return $old;
    }

    /**
     * A key column of an existing index as the dialog edits it and the create template takes
     * it: a plain column by its name (the server prints it quoted when it needs quotes), and no
     * collation when the column has its type's default one.
     *
     * @param array<string, mixed> $column
     * @return array<string, mixed>
     */
    private static function asEdited(array $column): array
    {
        $name = (string) $column['colname'];
        if (!$column['is_exp'] && preg_match('/^"((?:[^"]|"")+)"$/', $name, $m)) {
            $column['colname'] = str_replace('""', '"', $m[1]);
        }
        if (($column['collspcname'] ?? '') === 'pg_catalog."default"') {
            $column['collspcname'] = '';
        }

        return $column;
    }

    /**
     * A storage parameter as the templates print it, checked: they write it into WITH (…) and
     * SET (…) as it is, so a number must be digits, on/off true or false, buffering a mode.
     */
    private static function parameter(string $param, mixed $value): string
    {
        if (in_array($param, self::BOOLEAN_PARAMETERS, true)) {
            $value = is_bool($value) ? $value : filter_var($value, FILTER_VALIDATE_BOOLEAN, FILTER_NULL_ON_FAILURE);
            if ($value === null) {
                throw new BadRequestException(sprintf('%s must be on or off.', $param));
            }

            return $value ? 'true' : 'false';
        }
        $value = strtolower(trim((string) $value));
        if ($param === 'buffering') {
            if (!in_array($value, self::BUFFERING, true)) {
                throw new BadRequestException('buffering must be auto, on or off.');
            }

            return $value;
        }
        if (!ctype_digit($value)) {
            throw new BadRequestException(sprintf('%s must be a whole number.', $param));
        }

        return $value;
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
            if (isset($data[$param]) && $data[$param] !== '') {
                $data[$param] = $data['storage_parameters'][$param] = self::parameter($param, $data[$param]);
            }
        }
        // An empty comment stays: on an existing index it removes the comment.
        foreach (['indconstraint', 'spcname'] as $key) {
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
            // The collation and operator class are written as they come: names only.
            foreach (['collspcname', 'op_class'] as $key) {
                $value = trim((string) ($column[$key] ?? ''));
                if ($value !== '' && !preg_match('/^(?:"(?:[^"]|"")+"|[\\w$]+)(?:\\.(?:"(?:[^"]|"")+"|[\\w$]+))?$/u', $value)) {
                    throw new BadRequestException(sprintf('Not a valid %s: %s', $key === 'op_class' ? 'operator class' : 'collation', $value));
                }
                $column[$key] = $value === '' ? null : $value;
            }
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
            // The collation and operator class are compared only when the client names them: the
            // server reports the default collation on a column the dialog never asked about.
            $withCollation = array_filter($data['columns'], static fn (array $c): bool => !empty($c['collspcname'])) !== [];
            $withOpClass = array_filter($data['columns'], static fn (array $c): bool => !empty($c['op_class'])) !== [];
            $shape = static fn (array $c): string => implode('|', [
                (string) ($c['colname'] ?? ''),
                !empty($c['sort_order']) ? 'DESC' : 'ASC',
                !empty($c['nulls']) ? 'FIRST' : 'LAST',
                $withCollation ? (string) ($c['collspcname'] ?? '') : '',
                $withOpClass ? (string) ($c['op_class'] ?? '') : '',
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
