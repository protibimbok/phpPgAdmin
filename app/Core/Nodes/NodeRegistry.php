<?php

declare(strict_types=1);

namespace PhpPgAdmin\Core\Nodes;

use LogicException;
use PhpPgAdmin\Core\Facades\Route;
use Psr\Http\Message\ServerRequestInterface;

/**
 * Every node type the modules declared, and the API routes built from their parent chains.
 */
final class NodeRegistry
{
    /** @var array<string, NodeDefinition> keyed by type, in registration order */
    private array $nodes = [];

    /** @param iterable<NodeDefinition> $nodes */
    public function register(iterable $nodes): void
    {
        foreach ($nodes as $node) {
            if (isset($this->nodes[$node->type])) {
                throw new LogicException(sprintf('Node type [%s] is registered twice.', $node->type));
            }
            $this->nodes[$node->type] = $node;
        }
    }

    /** @return array<string, NodeDefinition> */
    public function all(): array
    {
        return $this->nodes;
    }

    public function get(string $type): NodeDefinition
    {
        return $this->nodes[$type] ?? throw new LogicException(sprintf('Unknown node type [%s].', $type));
    }

    public function find(string $type): ?NodeDefinition
    {
        return $this->nodes[$type] ?? null;
    }

    /**
     * The node types under the given type (NodeDefinition::DATABASE or ::SERVER for the roots)
     * that a server of the given version has, in registration order.
     *
     * @return list<NodeDefinition>
     */
    public function childrenOf(string $type, ?int $version = null): array
    {
        return array_values(array_filter(
            $this->nodes,
            static fn (NodeDefinition $n): bool => $n->parent === $type && ($version === null || $n->availableOn($version)),
        ));
    }

    /** Whether the node and its ancestors live under the server rather than inside a database. */
    public function isServerLevel(NodeDefinition $node): bool
    {
        $ancestors = $this->ancestors($node);

        return ($ancestors[0] ?? $node)->isServerLevel();
    }

    /**
     * The node's ancestors, outermost first, excluding the database or server root.
     *
     * @return list<NodeDefinition>
     */
    public function ancestors(NodeDefinition $node): array
    {
        $chain = [];
        $parent = $node->parent;
        $seen = [$node->type => true];

        while ($parent !== null && $parent !== NodeDefinition::DATABASE && $parent !== NodeDefinition::SERVER) {
            if (isset($seen[$parent])) {
                throw new LogicException(sprintf('Node [%s] has a cyclic parent chain.', $node->type));
            }
            $seen[$parent] = true;
            $definition = $this->get($parent);
            array_unshift($chain, $definition);
            $parent = $definition->parent;
        }

        return $chain;
    }

    /**
     * The collection's path under the database, "schemas/{scid:number}/tables".
     */
    public function collectionPath(NodeDefinition $node): string
    {
        $segments = [];
        foreach ($this->ancestors($node) as $ancestor) {
            $segments[] = sprintf('%s/{%s:number}', $ancestor->collection, $ancestor->idParam);
        }
        $segments[] = $node->collection;

        return implode('/', $segments);
    }

    /** "/server" for server-level nodes, "/databases/{db}" for the ones inside a database. */
    public function rootPath(NodeDefinition $node): string
    {
        return $this->isServerLevel($node) ? '/server' : '/databases/{db}';
    }

    /**
     * Register the routes of every node, within the current route group. Server-level nodes
     * are under /server, the others under the database they are in, addressed by name;
     * objects are addressed by OID. The static segments ("nodes", "msql") never clash with an
     * OID because the OID parameters only match digits.
     */
    public function registerRoutes(): void
    {
        foreach (['/server', '/databases/{db}'] as $root) {
            Route::get("{$root}/nodes", fn (ServerRequestInterface $request, array $args) => NodeDispatcher::catalog($this, $request, $args));
            Route::get("{$root}/resolve", fn (ServerRequestInterface $request, array $args) => NodeDispatcher::resolve($this, $request, $args));
        }

        foreach ($this->nodes as $node) {
            $base = $this->rootPath($node) . '/' . $this->collectionPath($node);
            $item = $base . '/{' . $node->idParam . ':number}';
            $dispatch = fn (string $operation) => fn (ServerRequestInterface $request, array $args) => NodeDispatcher::handle($this, $node, $operation, $request, $args);

            Route::get($base, $dispatch('list'));
            Route::get("{$base}/nodes", $dispatch('nodes'));
            Route::post($base, $dispatch('create'));
            Route::get($item, $dispatch('properties'));
            Route::get("{$item}/node", $dispatch('node'));
            Route::put($item, $dispatch('update'));
            Route::delete($item, $dispatch('delete'));

            if ($node->supports('msql')) {
                Route::post("{$base}/msql", $dispatch('msql'));
                Route::post("{$item}/msql", $dispatch('msql'));
            }
            if ($node->supports('sql')) {
                Route::get("{$item}/sql", $dispatch('sql'));
            }
            if ($node->supports('stats')) {
                Route::get("{$base}/stats", $dispatch('stats'));
                Route::get("{$item}/stats", $dispatch('stats'));
            }
            if ($node->supports('depends')) {
                Route::get("{$item}/dependencies", $dispatch('dependencies'));
                Route::get("{$item}/dependents", $dispatch('dependents'));
            }
            if ($node->supports('children')) {
                Route::get("{$item}/children", $dispatch('children'));
            }
        }
    }
}
