<?php

declare(strict_types=1);

namespace PhpPgAdmin\Modules\Tables\Http\Controllers;

use PhpPgAdmin\Core\Nodes\NodeContext;
use PhpPgAdmin\Modules\Tables\Ddl\ColumnSql;

/**
 * The column node, after pgAdmin's ColumnsView. A column's id is its attribute number. The
 * client's data carries pgAdmin's field names (see ColumnSql).
 */
final class ColumnController extends TableChildController
{
    /** ALTER TABLE … ADD COLUMN; the new column's node. */
    public function create(NodeContext $ctx, array $data): array
    {
        $this->requireName($data);
        $this->requireName($data, 'cltype');
        [$schema, $table] = $this->parent($ctx);
        $this->execute($ctx, ColumnSql::createSql($ctx, $schema, $table, $data));

        $attnum = $ctx->conn->scalar($ctx->render('get_position.sql', ['tid' => $ctx->id('tid'), 'data' => $data])) ?? throw $this->gone($ctx);

        return $this->node($ctx, (int) $attnum);
    }

    /** The ALTER statements for what differs from the column as it stands. */
    public function update(NodeContext $ctx, int $oid, array $data): array
    {
        [$schema, $table] = $this->parent($ctx);
        $this->execute($ctx, ColumnSql::updateSql($ctx, (int) $ctx->id('tid'), $schema, $table, $data, $oid));

        return $this->node($ctx, $oid);
    }

    public function delete(NodeContext $ctx, int $oid, bool $cascade): void
    {
        [$schema, $table] = $this->parent($ctx);
        $column = $this->properties($ctx, $oid);
        $this->execute($ctx, ColumnSql::deleteSql($ctx, $schema, $table, (string) $column['name']));
    }

    public function modifiedSql(NodeContext $ctx, ?int $oid, array $data): string
    {
        [$schema, $table] = $this->parent($ctx);
        if ($oid === null) {
            $this->requireName($data);
            $this->requireName($data, 'cltype');

            return ColumnSql::createSql($ctx, $schema, $table, $data);
        }

        return ColumnSql::updateSql($ctx, (int) $ctx->id('tid'), $schema, $table, $data, $oid);
    }

    /** @return array{0: string, 1: string} the schema and the table */
    private function parent(NodeContext $ctx): array
    {
        $row = $ctx->conn->row($ctx->render('get_parent.sql', ['tid' => $ctx->id('tid')])) ?? throw $this->notFound('Could not find the table.');

        return [(string) $row['schema'], (string) $row['table']];
    }

    protected function toNode(NodeContext $ctx, array $row): array
    {
        $node = parent::toNode($ctx, $row);
        $node['inode'] = false;

        return $node;
    }
}
