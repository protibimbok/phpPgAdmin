<?php

declare(strict_types=1);

namespace PhpPgAdmin\Modules\Tables\Http\Controllers;

use PhpPgAdmin\Core\Nodes\NodeContext;
use PhpPgAdmin\Modules\Tables\Ddl\IndexDdl;
use PhpPgAdmin\Modules\Tables\Ddl\IndexSql;

/**
 * The index node, after pgAdmin's IndexesView: the indexes of a table that are not a
 * constraint's, and the statements that create, alter and drop one.
 */
final class IndexController extends TableChildController
{
    public function sql(NodeContext $ctx, int $oid): string
    {
        [$schema, $table] = $this->parent($ctx);

        return IndexDdl::sql($ctx, $schema, $table, (int) $ctx->id('tid'), $oid);
    }

    /** The properties with the columns and INCLUDE list, as the dialog edits them. */
    public function properties(NodeContext $ctx, int $oid): array
    {
        return IndexSql::current($ctx, (int) $ctx->id('tid'), $oid);
    }

    /** CREATE INDEX (on its own when CONCURRENTLY, which cannot share a transaction), then its comment and CLUSTER. */
    public function create(NodeContext $ctx, array $data): array
    {
        [$schema, $table] = $this->parent($ctx);
        [$create, $alter] = IndexSql::createParts($ctx, $schema, $table, $data);
        $this->execute($ctx, $create);
        $this->execute($ctx, $alter);

        return $this->node($ctx, $this->oidOf($ctx, (string) ($data['name'] ?? '')));
    }

    /** ALTER INDEX, or DROP and CREATE when the definition changed; the node under its (new) name. */
    public function update(NodeContext $ctx, int $oid, array $data): array
    {
        [$schema, $table] = $this->parent($ctx);
        $old = IndexSql::current($ctx, (int) $ctx->id('tid'), $oid);
        $change = IndexSql::updateSql($ctx, (int) $ctx->id('tid'), $schema, $table, $oid, $data);
        $this->execute($ctx, $change['sql']);

        $name = trim((string) ($data['name'] ?? '')) ?: (string) $old['name'];

        return $this->node($ctx, $change['recreated'] ? $this->oidOf($ctx, $name) : $oid);
    }

    public function delete(NodeContext $ctx, int $oid, bool $cascade): void
    {
        [$schema] = $this->parent($ctx);
        $old = IndexSql::current($ctx, (int) $ctx->id('tid'), $oid);
        $this->execute($ctx, IndexSql::deleteSql($ctx, $schema, (string) $old['name'], $cascade));
    }

    public function modifiedSql(NodeContext $ctx, ?int $oid, array $data): string
    {
        [$schema, $table] = $this->parent($ctx);
        if ($oid === null) {
            return IndexSql::createSql($ctx, $schema, $table, $data);
        }

        return IndexSql::updateSql($ctx, (int) $ctx->id('tid'), $schema, $table, $oid, $data)['sql'];
    }

    /** @return array{0: string, 1: string} */
    private function parent(NodeContext $ctx): array
    {
        $row = $ctx->conn->row($ctx->render('get_parent.sql', ['tid' => $ctx->id('tid')])) ?? throw $this->notFound('Could not find the table.');

        return [(string) $row['schema'], (string) $row['table']];
    }

    /** An index of the table by name; a nameless CREATE INDEX gets the server's name, found through the newest index. */
    private function oidOf(NodeContext $ctx, string $name): int
    {
        if ($name !== '') {
            $oid = $ctx->conn->scalar($ctx->render('get_oid.sql', ['tid' => $ctx->id('tid'), 'data' => ['name' => $name]]));
            if ($oid !== null) {
                return (int) $oid;
            }
        }
        $oid = $ctx->conn->scalar('SELECT indexrelid FROM pg_catalog.pg_index WHERE indrelid = $1 ORDER BY indexrelid DESC LIMIT 1', [$ctx->id('tid')]);

        return (int) ($oid ?? throw $this->gone($ctx));
    }
}
