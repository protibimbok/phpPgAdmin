<?php

declare(strict_types=1);

namespace PhpPgAdmin\Modules\Tables\Ddl;

use League\Route\Http\Exception\GoneException;
use PhpPgAdmin\Core\Nodes\Ddl;
use PhpPgAdmin\Core\Nodes\NodeContext;
use PhpPgAdmin\Modules\Databases\Http\Controllers\DatabaseController;

/** The DDL of one index: indexes/utils.py's get_reverse_engineered_sql. */
final class IndexDdl
{
    private const array STORAGE_PARAMETERS = [
        'btree' => ['fillfactor', 'deduplicate_items'],
        'hash' => ['fillfactor'],
        'gist' => ['fillfactor', 'buffering'],
        'gin' => ['fastupdate', 'gin_pending_list_limit'],
        'spgist' => ['fillfactor'],
        'brin' => ['pages_per_range', 'autosummarize'],
        'heap' => [],
        'ivfflat' => ['lists'],
    ];

    private const string AUTO_CREATED = "-- NOTE:\n--\n-- This index is created automatically by a constraint and cannot be edited.\n--\n\n";

    /**
     * @param bool $withHeader "-- Index: name" and the commented DROP in front, as the SQL tab shows it
     */
    public static function sql(NodeContext $ctx, string $schema, string $table, int $tid, int $idx, bool $withHeader = true, bool $ifNotExists = false): string
    {
        $data = $ctx->conn->row($ctx->renderFrom('indexes', 'properties.sql', [
            'tid' => $tid, 'idx' => $idx, 'datlastsysoid' => DatabaseController::LAST_SYSTEM_OID, 'show_sys_objects' => true,
        ])) ?? throw new GoneException('Could not find the index in the table.');

        $data['schema'] = $schema;
        $data['table'] = $table;
        $data['storage_parameters'] = [];
        foreach (self::STORAGE_PARAMETERS[$data['amname']] ?? [] as $param) {
            if (isset($data[$param])) {
                $data['storage_parameters'][$param] = is_bool($data[$param]) ? ($data[$param] ? 'true' : 'false') : $data[$param];
            }
        }
        $data['dependsonextensions'] = $data['dependsonextensions'] === null ? [] : \PhpPgAdmin\Core\Nodes\Options::list($data['dependsonextensions']);

        $data['columns'] = self::columns($ctx, $idx, (string) ($data['amname'] ?? ''));
        $data['include'] = self::include($ctx, $idx);

        $sql = Ddl::assemble([
            $ctx->renderFrom('indexes', 'create.sql', ['data' => $data, 'mode' => null, 'add_not_exists_clause' => $ifNotExists]),
            $ctx->renderFrom('indexes', 'alter.sql', ['data' => $data]),
        ]);

        if (!$withHeader) {
            return $sql;
        }

        $header = ($data['conname'] !== null ? self::AUTO_CREATED : '') . Ddl::header('Index', (string) $data['name'], $ctx->renderFrom('indexes', 'delete.sql', ['data' => $data]));

        return Ddl::assemble([$header, $sql]);
    }

    /** The INCLUDE columns of an index, by name. @return list<string> */
    public static function include(NodeContext $ctx, int $idx): array
    {
        return array_column($ctx->conn->rows($ctx->renderFrom('indexes', 'include_details.sql', ['idx' => $idx])), 'colname');
    }

    /**
     * The index's key columns as create.sql renders them in its non-create mode: the definition
     * the server prints, plus collation, operator class, order and nulls placement for btree.
     *
     * @return list<array<string, mixed>>
     */
    public static function columns(NodeContext $ctx, int $idx, string $amname): array
    {
        $rows = $ctx->conn->rows($ctx->renderFrom('indexes', 'column_details.sql', ['idx' => $idx]));
        $columns = [];
        $seen = [];

        foreach ($rows as $row) {
            $key = json_encode($row);
            if (isset($seen[$key])) {
                continue;
            }
            $seen[$key] = true;

            $options = \PhpPgAdmin\Core\Nodes\Options::list($row['options']);
            $column = [
                'colname' => $row['attdef'],
                'collspcname' => $row['collnspname'],
                'op_class' => $row['opcname'],
                'col_num' => $row['attnum'],
                'is_exp' => (bool) $row['is_exp'],
                'statistics' => $row['statistics'],
            ];
            if ($amname === 'btree') {
                $column['sort_order'] = ($options[0] ?? 'ASC') === 'DESC';
                $column['nulls'] = str_ends_with($options[1] ?? 'NULLS LAST', 'FIRST');
            }
            $columns[] = $column;
        }

        return $columns;
    }
}
