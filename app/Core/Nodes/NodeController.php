<?php

declare(strict_types=1);

namespace PhpPgAdmin\Core\Nodes;

use League\Route\Http\Exception\GoneException;
use League\Route\Http\Exception\MethodNotAllowedException;
use League\Route\Http\Exception\NotFoundException;

/**
 * The operations every node answers, after pgAdmin's PGChildNodeView. A node's controller
 * extends this and implements what its templates support; what it leaves out answers 405.
 *
 * Conventions the defaults rely on, from pgAdmin's templates: "nodes.sql" lists the children
 * with oid and name (and takes the node's id to return one), "properties.sql" gives one row per
 * object with every property, and the DDL comes from "create.sql" and "delete.sql".
 */
abstract class NodeController
{
    /** The objects of the collection, with every property: what a list page shows. */
    public function list(NodeContext $ctx): array
    {
        return $ctx->rows('properties.sql');
    }

    /**
     * The tree children of the collection.
     *
     * @return list<array<string, mixed>>
     */
    public function nodes(NodeContext $ctx): array
    {
        return array_map(fn (array $row): array => $this->toNode($ctx, $row), $ctx->rows('nodes.sql'));
    }

    /**
     * One tree node, by OID.
     *
     * @return array<string, mixed>
     */
    public function node(NodeContext $ctx, int $oid): array
    {
        $row = $ctx->row('nodes.sql', [$ctx->node->idParam => $oid]) ?? throw $this->gone($ctx);

        return $this->toNode($ctx, $row);
    }

    /** @return array<string, mixed> */
    public function properties(NodeContext $ctx, int $oid): array
    {
        return $ctx->row('properties.sql', [$ctx->node->idParam => $oid]) ?? throw $this->gone($ctx);
    }

    /**
     * Create the object from the client's data and return its tree node.
     *
     * @param array<string, mixed> $data
     * @return array<string, mixed>
     */
    public function create(NodeContext $ctx, array $data): array
    {
        throw $this->notSupported('create');
    }

    /**
     * Change the object from the client's data and return its tree node.
     *
     * @param array<string, mixed> $data
     * @return array<string, mixed>
     */
    public function update(NodeContext $ctx, int $oid, array $data): array
    {
        throw $this->notSupported('update');
    }

    public function delete(NodeContext $ctx, int $oid, bool $cascade): void
    {
        throw $this->notSupported('delete');
    }

    /** The reverse-engineered DDL of the object. */
    public function sql(NodeContext $ctx, int $oid): string
    {
        throw $this->notSupported('sql');
    }

    /**
     * The DDL that creating ($oid null) or changing the object with the given data would run.
     *
     * @param array<string, mixed> $data
     */
    public function modifiedSql(NodeContext $ctx, ?int $oid, array $data): string
    {
        throw $this->notSupported('msql');
    }

    /**
     * Statistics of one object, or of the whole collection when $oid is null.
     *
     * @return array{columns: list<array{name: string, type: string}>, rows: list<array<string, mixed>>}
     */
    public function statistics(NodeContext $ctx, ?int $oid): array
    {
        $result = $ctx->query($oid === null ? 'coll_stats.sql' : 'stats.sql', $oid === null ? [] : [$ctx->node->idParam => $oid]);

        return [
            'columns' => array_map(static fn ($c): array => ['name' => $c->name, 'type' => $c->typeName], $result->columns()),
            'rows' => $result->rows(),
        ];
    }

    /** @return list<array{type: string, name: string, field: string, icon: string|null}> */
    public function dependencies(NodeContext $ctx, int $oid): array
    {
        return Dependencies::of($ctx->conn, $oid, showSystemObjects: $ctx->flag('system_objects'));
    }

    /** @return list<array{type: string, name: string, field: string, icon: string|null}> */
    public function dependents(NodeContext $ctx, int $oid): array
    {
        return Dependencies::dependents($ctx->conn, $oid, showSystemObjects: $ctx->flag('system_objects'));
    }

    /**
     * The node types that may appear under this object on this server.
     *
     * @return list<array<string, mixed>>
     */
    public function children(NodeContext $ctx, int $oid): array
    {
        return array_map(static fn (NodeDefinition $n): array => $n->toArray(), $ctx->registry->childrenOf($ctx->node->type, $ctx->version()));
    }

    /**
     * The OIDs of the object named by the query parameters (schema, name…), outermost first:
     * what the client needs to turn a name-based URL into the node routes.
     *
     * @param array<string, mixed> $params
     * @return array<string, int>|null null when there is no such object
     */
    public function resolve(NodeContext $ctx, array $params): ?array
    {
        throw $this->notSupported('resolve');
    }

    /**
     * A tree node from a catalog row with "oid" and "name". Nodes carry what pgAdmin's
     * generate_browser_node does: the id, label, type, icon, whether it may have children,
     * and the rest of the row as metadata.
     *
     * @param array<string, mixed> $row
     * @return array<string, mixed>
     */
    protected function toNode(NodeContext $ctx, array $row): array
    {
        $oid = (int) ($row['oid'] ?? 0);
        $meta = $row;
        unset($meta['oid'], $meta['name']);

        return [
            'id' => $ctx->node->type . '_' . $oid,
            'oid' => $oid,
            'label' => (string) ($row['name'] ?? ''),
            'type' => $ctx->node->type,
            'icon' => $this->icon($ctx, $row),
            'inode' => $ctx->registry->childrenOf($ctx->node->type, $ctx->version()) !== [],
            'meta' => $meta,
        ];
    }

    /** @param array<string, mixed> $row */
    protected function icon(NodeContext $ctx, array $row): string
    {
        return $ctx->node->icon;
    }

    /** The object was deleted under the client: pgAdmin's "It may have been removed by another user." */
    protected function gone(NodeContext $ctx): GoneException
    {
        return new GoneException(sprintf('Could not find the %s in the database. It may have been removed by another user.', str_replace('_', ' ', $ctx->node->type)));
    }

    protected function notFound(string $message): NotFoundException
    {
        return new NotFoundException($message);
    }

    protected function notSupported(string $operation): MethodNotAllowedException
    {
        return new MethodNotAllowedException([], sprintf('The %s node does not support "%s".', static::class, $operation));
    }
}
