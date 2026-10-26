<?php

declare(strict_types=1);

namespace PhpPgAdmin\Core\Nodes;

use PhpPgAdmin\Modules\Databases\Http\Controllers\DatabaseController;

/**
 * Shared ground for the nodes that are relations in a schema (tables, views, materialized views,
 * sequences): pgAdmin's templates take the schema's OID as "scid", the object's own under the
 * node's id parameter, and the last system OID to tell system objects apart.
 */
abstract class RelationController extends NodeController
{
    /** The extra variables pgAdmin's relation templates read. */
    protected function vars(NodeContext $ctx, ?int $oid = null): array
    {
        $vars = ['datlastsysoid' => DatabaseController::LAST_SYSTEM_OID];
        if ($oid !== null) {
            $vars[$ctx->node->idParam] = $oid;
        }

        return $vars;
    }

    public function list(NodeContext $ctx): array
    {
        return $ctx->rows('properties.sql', $this->vars($ctx));
    }

    public function nodes(NodeContext $ctx): array
    {
        return array_map(fn (array $row): array => $this->toNode($ctx, $row), $ctx->rows('nodes.sql', $this->vars($ctx)));
    }

    public function node(NodeContext $ctx, int $oid): array
    {
        $row = $ctx->row('nodes.sql', $this->vars($ctx, $oid)) ?? throw $this->gone($ctx);

        return $this->toNode($ctx, $row);
    }

    public function properties(NodeContext $ctx, int $oid): array
    {
        return $ctx->row('properties.sql', $this->vars($ctx, $oid)) ?? throw $this->gone($ctx);
    }

    /** The relation kinds (pg_class.relkind) the node covers. */
    abstract protected function relkinds(): array;

    /**
     * A relation by schema and name: resolve('table', {schema, name}) → {scid, tid}.
     *
     * @param array<string, mixed> $params
     * @return array<string, int>|null
     */
    public function resolve(NodeContext $ctx, array $params): ?array
    {
        $schema = (string) ($params['schema'] ?? '');
        $name = (string) ($params['name'] ?? '');
        if ($schema === '' || $name === '') {
            return null;
        }

        $row = $ctx->conn->row(
            'SELECT rel.oid, rel.relnamespace FROM pg_catalog.pg_class rel JOIN pg_catalog.pg_namespace nsp ON nsp.oid = rel.relnamespace WHERE nsp.nspname = $1 AND rel.relname = $2 AND rel.relkind = ANY($3::"char"[])',
            [$schema, $name, '{' . implode(',', $this->relkinds()) . '}'],
        );

        return $row === null ? null : ['scid' => (int) $row['relnamespace'], $ctx->node->idParam => (int) $row['oid']];
    }
}
