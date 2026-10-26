<?php

declare(strict_types=1);

namespace PhpPgAdmin\Modules\Tables\Http\Controllers;

use PhpPgAdmin\Core\Nodes\NodeContext;
use PhpPgAdmin\Core\Nodes\RelationController;
use PhpPgAdmin\Modules\Tables\Ddl\TableDdl;

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

    /** The properties with privileges, columns and constraints, as pgAdmin's dialog reads them. */
    public function properties(NodeContext $ctx, int $oid): array
    {
        return TableDdl::properties($ctx, $oid, parent::properties($ctx, $oid));
    }

    /** The "SQL" tab: the DDL that recreates the table with its constraints, comments and indexes. */
    public function sql(NodeContext $ctx, int $oid): string
    {
        return TableDdl::sql($ctx, $oid, parent::properties($ctx, $oid));
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
