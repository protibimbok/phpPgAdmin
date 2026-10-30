<?php

declare(strict_types=1);

namespace PhpPgAdmin\Modules\Tables\Ddl;

use PhpPgAdmin\Core\Database\Quoting;
use PhpPgAdmin\Core\Nodes\NodeContext;
use PhpPgAdmin\Core\Nodes\Options;

/**
 * A table's constraints as pgAdmin's constraints.macro takes them: the utils.py fetchers of
 * the index_constraint, foreign_key, check_constraint and exclusion_constraint nodes.
 */
final class Constraints
{
    /**
     * Primary keys ('p') or unique constraints ('u'), each with its columns and INCLUDE list.
     *
     * @return list<array<string, mixed>>
     */
    public static function indexConstraints(NodeContext $ctx, int $tid, string $type): array
    {
        $rows = $ctx->conn->rows($ctx->renderFrom('index_constraint', 'properties.sql', ['tid' => $tid, 'cid' => null, 'constraint_type' => $type]));

        foreach ($rows as &$row) {
            $columns = $ctx->conn->rows($ctx->renderFrom('index_constraint', 'get_constraint_cols.sql', ['cid' => $row['oid'], 'colcnt' => $row['col_count']]));
            $row['columns'] = array_map(static fn (array $c): array => ['column' => Quoting::unquoteIdent((string) $c['column'])], $columns);
            $row['include'] = array_column($ctx->conn->rows($ctx->renderFrom('index_constraint', 'get_constraint_include.sql', ['cid' => $row['oid']])), 'colname');
        }
        unset($row);

        return $rows;
    }

    /**
     * Foreign keys, each with its column pairs and the referenced table.
     *
     * @return list<array<string, mixed>>
     */
    public static function foreignKeys(NodeContext $ctx, int $tid): array
    {
        $rows = $ctx->conn->rows($ctx->renderFrom('foreign_key', 'properties.sql', ['tid' => $tid, 'cid' => null]));

        foreach ($rows as &$fk) {
            $confkey = array_map(intval(...), Options::list($fk['confkey']));
            $conkey = array_map(intval(...), Options::list($fk['conkey']));
            $keys = array_map(null, $confkey, $conkey);

            $columns = [];
            foreach ($ctx->conn->rows($ctx->renderFrom('foreign_key', 'get_constraint_cols.sql', ['tid' => $tid, 'keys' => $keys, 'confrelid' => $fk['confrelid']])) as $pair) {
                $columns[] = [
                    'local_column' => $pair['conattname'],
                    'references' => $fk['confrelid'],
                    'referenced' => $pair['confattname'],
                    'references_table_name' => $fk['refnsp'] . '.' . $fk['reftab'],
                ];
            }
            $fk['columns'] = $columns;
            // PostgreSQL 15's ON DELETE SET NULL / SET DEFAULT (columns); absent before.
            $fk['confdelsetcols'] = array_key_exists('confdelsetcols', $fk) ? Options::list($fk['confdelsetcols']) : [];
            $fk['remote_schema'] = $fk['refnsp'];
            $fk['remote_table'] = $fk['reftab'];
        }
        unset($fk);

        return $rows;
    }

    /** @return list<array<string, mixed>> */
    public static function checks(NodeContext $ctx, int $tid): array
    {
        return $ctx->conn->rows($ctx->renderFrom('check_constraint', 'properties.sql', ['tid' => $tid, 'cid' => null]));
    }

    /**
     * Exclusion constraints, each with its columns (expression, operator class, order, operator).
     *
     * @return list<array<string, mixed>>
     */
    public static function exclusions(NodeContext $ctx, int $tid): array
    {
        $rows = $ctx->conn->rows($ctx->renderFrom('exclusion_constraint', 'properties.sql', ['tid' => $tid, 'cid' => null]));

        foreach ($rows as &$ex) {
            $columns = [];
            foreach ($ctx->conn->rows($ctx->renderFrom('exclusion_constraint', 'get_constraint_cols.sql', ['cid' => $ex['oid'], 'colcnt' => $ex['col_count']])) as $c) {
                $options = (int) $c['options'];
                $columns[] = [
                    'column' => Quoting::unquoteIdent((string) $c['coldef']),
                    'oper_class' => $c['opcname'],
                    // bit 1: DESC; bit 2: NULLS FIRST
                    'order' => ($options & 1) === 0,
                    'nulls_order' => ($options & 2) !== 0,
                    'operator' => $c['oprname'],
                    'col_type' => $c['datatype'],
                    'is_exp' => (bool) $c['is_exp'],
                    // ASC/DESC and NULLS only mean something to btree
                    'is_sort_nulls_applicable' => ($ex['amname'] ?? 'btree') === 'btree',
                ];
            }
            $ex['columns'] = $columns;
            $ex['include'] = array_column($ctx->conn->rows($ctx->renderFrom('exclusion_constraint', 'get_constraint_include.sql', ['cid' => $ex['oid']])), 'colname');
            if (($ex['amname'] ?? '') === '') {
                $ex['amname'] = 'btree';
            }
        }
        unset($ex);

        return $rows;
    }
}
