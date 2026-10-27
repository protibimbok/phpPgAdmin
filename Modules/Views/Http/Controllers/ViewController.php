<?php

declare(strict_types=1);

namespace PhpPgAdmin\Modules\Views\Http\Controllers;

use PhpPgAdmin\Core\Nodes\Catalog;
use PhpPgAdmin\Core\Nodes\NodeContext;
use PhpPgAdmin\Core\Nodes\RelationController;
use PhpPgAdmin\Modules\Views\Ddl\ViewDdl;

/**
 * The view node, after pgAdmin's ViewNode: the views of a schema with their privileges, and
 * the statements that create, alter and drop one.
 */
final class ViewController extends RelationController
{
    protected function relkinds(): array
    {
        return ['v'];
    }

    /** The properties with the privileges and security labels, as pgAdmin's dialog reads them. */
    public function properties(NodeContext $ctx, int $oid): array
    {
        return ViewDdl::properties($ctx, $oid, parent::properties($ctx, $oid), materialized: false);
    }

    /** The "SQL" tab: the DDL that recreates the view with its grants and column comments. */
    public function sql(NodeContext $ctx, int $oid): string
    {
        return ViewDdl::sql($ctx, $oid, parent::properties($ctx, $oid), materialized: false);
    }

    /** CREATE VIEW from the client's data; the new view's node. */
    public function create(NodeContext $ctx, array $data): array
    {
        $this->execute($ctx, ViewDdl::createSql($ctx, $data, materialized: false));

        return $this->node($ctx, $this->oidOf($ctx, (string) $data['name']));
    }

    /** ALTER VIEW (or DROP and CREATE) for what the client's data changes. */
    public function update(NodeContext $ctx, int $oid, array $data): array
    {
        $this->execute($ctx, ViewDdl::updateSql($ctx, $oid, $data, $this->properties($ctx, $oid), materialized: false));

        return $this->node($ctx, $oid);
    }

    /** DROP VIEW, CASCADE on request. */
    public function delete(NodeContext $ctx, int $oid, bool $cascade): void
    {
        $row = parent::properties($ctx, $oid);
        $this->execute($ctx, $ctx->render('delete.sql', ['vid' => null, 'name' => $row['name'], 'nspname' => $row['schema'], 'cascade' => $cascade]));
    }

    public function modifiedSql(NodeContext $ctx, ?int $oid, array $data): string
    {
        if ($oid === null) {
            return ViewDdl::createSql($ctx, $data, materialized: false);
        }

        return ViewDdl::updateSql($ctx, $oid, $data, $this->properties($ctx, $oid), materialized: false);
    }

    /**
     * What the create and alter forms offer: the roles a view may be owned by, the schemas it
     * may be moved to, the tablespaces and table access methods a materialized view may use.
     *
     * @return array{roles: list<string>, schemas: list<string>, tablespaces: list<string>, access_methods: list<string>}
     */
    public function options(NodeContext $ctx): array
    {
        return [
            'roles' => Catalog::roles($ctx->conn),
            'schemas' => Catalog::schemas($ctx->conn),
            'tablespaces' => Catalog::tablespaces($ctx->conn),
            'access_methods' => array_column($ctx->conn->rows($ctx->renderFrom('mviews', 'get_access_methods.sql')), 'amname'),
        ];
    }

    /** A view of the route's schema by name. */
    protected function oidOf(NodeContext $ctx, string $name): int
    {
        $oid = $ctx->conn->scalar(
            'SELECT c.oid FROM pg_catalog.pg_class c WHERE c.relnamespace = $1 AND c.relname = $2 AND c.relkind = ANY($3::"char"[])',
            [$ctx->id('scid'), $name, '{' . implode(',', $this->relkinds()) . '}'],
        );

        return (int) ($oid ?? throw $this->gone($ctx));
    }

    protected function icon(NodeContext $ctx, array $row): string
    {
        return 'b_views';
    }
}
