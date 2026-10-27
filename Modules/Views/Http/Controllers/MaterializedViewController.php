<?php

declare(strict_types=1);

namespace PhpPgAdmin\Modules\Views\Http\Controllers;

use PhpPgAdmin\Core\Nodes\NodeContext;
use PhpPgAdmin\Core\Nodes\RelationController;
use PhpPgAdmin\Modules\Views\Ddl\ViewDdl;

/**
 * The materialized view node, after pgAdmin's MViewNode: the materialized views of a schema
 * with their storage settings and privileges, the statements that create, alter, refresh and
 * drop one, and their statistics.
 */
final class MaterializedViewController extends RelationController
{
    protected function relkinds(): array
    {
        return ['m'];
    }

    /** The properties with the privileges, autovacuum settings and security labels. */
    public function properties(NodeContext $ctx, int $oid): array
    {
        return ViewDdl::properties($ctx, $oid, parent::properties($ctx, $oid), materialized: true);
    }

    /** The "SQL" tab: the DDL that recreates the materialized view with its grants, column comments and indexes. */
    public function sql(NodeContext $ctx, int $oid): string
    {
        return ViewDdl::sql($ctx, $oid, parent::properties($ctx, $oid), materialized: true);
    }

    /** CREATE MATERIALIZED VIEW from the client's data; the new view's node. */
    public function create(NodeContext $ctx, array $data): array
    {
        $this->execute($ctx, ViewDdl::createSql($ctx, $data, materialized: true));

        return $this->node($ctx, $this->oidOf($ctx, (string) $data['name']));
    }

    /** ALTER MATERIALIZED VIEW (or DROP and CREATE) for what the client's data changes. */
    public function update(NodeContext $ctx, int $oid, array $data): array
    {
        $this->execute($ctx, ViewDdl::updateSql($ctx, $oid, $data, $this->properties($ctx, $oid), materialized: true));

        return $this->node($ctx, $oid);
    }

    /** DROP MATERIALIZED VIEW, CASCADE on request. */
    public function delete(NodeContext $ctx, int $oid, bool $cascade): void
    {
        $row = parent::properties($ctx, $oid);
        $this->execute($ctx, $ctx->render('delete.sql', ['vid' => null, 'name' => $row['name'], 'nspname' => $row['schema'], 'cascade' => $cascade]));
    }

    public function modifiedSql(NodeContext $ctx, ?int $oid, array $data): string
    {
        if ($oid === null) {
            return ViewDdl::createSql($ctx, $data, materialized: true);
        }

        return ViewDdl::updateSql($ctx, $oid, $data, $this->properties($ctx, $oid), materialized: true);
    }

    /**
     * REFRESH MATERIALIZED VIEW, CONCURRENTLY and WITH NO DATA on request (pgAdmin's
     * refresh_data); the statement run comes back.
     */
    public function refresh(NodeContext $ctx, int $oid, bool $concurrent, bool $withData): string
    {
        $row = $ctx->row('get_view_name.sql', ['vid' => $oid]) ?? throw $this->gone($ctx);
        $sql = $ctx->render('refresh.sql', ['name' => $row['name'], 'nspname' => $row['schema'], 'is_concurrent' => $concurrent, 'with_data' => $withData]);
        $this->execute($ctx, $sql);

        return $sql;
    }

    /**
     * The statistics of one materialized view (pg_stat_all_tables, with pgstattuple when the
     * extension is installed), or of every one in the schema.
     */
    public function statistics(NodeContext $ctx, ?int $oid): array
    {
        if ($oid === null) {
            $result = $ctx->query('coll_mview_stats.sql', ['schema_name' => ViewDdl::schemaName($ctx)]);
        } else {
            $hasPgstattuple = (bool) $ctx->conn->scalar("SELECT EXISTS (SELECT 1 FROM pg_catalog.pg_extension WHERE extname = 'pgstattuple')");
            $result = $ctx->query('stats.sql', ['vid' => $oid, 'is_pgstattuple' => $hasPgstattuple]);
        }

        return [
            'columns' => array_map(static fn ($c): array => ['name' => $c->name, 'type' => $c->typeName], $result->columns()),
            'rows' => $result->rows(),
        ];
    }

    /** A materialized view of the route's schema by name. */
    protected function oidOf(NodeContext $ctx, string $name): int
    {
        $oid = $ctx->conn->scalar(
            'SELECT c.oid FROM pg_catalog.pg_class c WHERE c.relnamespace = $1 AND c.relname = $2 AND c.relkind = \'m\'',
            [$ctx->id('scid'), $name],
        );

        return (int) ($oid ?? throw $this->gone($ctx));
    }

    protected function icon(NodeContext $ctx, array $row): string
    {
        return 'b_views';
    }
}
