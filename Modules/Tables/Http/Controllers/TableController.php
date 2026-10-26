<?php

declare(strict_types=1);

namespace PhpPgAdmin\Modules\Tables\Http\Controllers;

use PhpPgAdmin\Core\Nodes\NodeContext;
use PhpPgAdmin\Core\Nodes\RelationController;

/**
 * The table node, after pgAdmin's TableView: the tables of a schema (partitions are shown under
 * their parent), with pgAdmin's properties row per table.
 */
final class TableController extends RelationController
{
    protected function relkinds(): array
    {
        return ['r', 's', 't', 'p'];
    }

    /** The exact row count, which the structure page asks for on demand (pgAdmin's count_rows). */
    public function countRows(NodeContext $ctx, int $oid): int
    {
        $row = $ctx->row('nodes.sql', $this->vars($ctx, $oid)) ?? throw $this->gone($ctx);
        $schema = (string) $ctx->conn->scalar('SELECT nspname FROM pg_catalog.pg_namespace WHERE oid = $1', [$ctx->id('scid')]);

        return (int) $ctx->conn->scalar($ctx->render('get_table_row_count.sql', ['data' => ['schema' => $schema, 'name' => $row['name']]]));
    }

    protected function icon(NodeContext $ctx, array $row): string
    {
        return 's_tbl';
    }
}
