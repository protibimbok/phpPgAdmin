<?php

declare(strict_types=1);

namespace PhpPgAdmin\Core\Nodes;

use League\Route\Http\Exception\BadRequestException;
use League\Route\Http\Exception\NotFoundException;
use Nyholm\Psr7\Response;
use PhpPgAdmin\Core\Database\ConnectionPool;
use Psr\Http\Message\ResponseInterface;
use Psr\Http\Message\ServerRequestInterface;

/**
 * Turns a matched node route into a controller call: opens the database's connection, checks
 * the node exists on this server version, collects the OIDs from the route and shapes the
 * controller's answer into the JSON the client expects.
 */
final class NodeDispatcher
{
    /**
     * @param array<string, string> $args the route parameters
     * @return array<string, mixed>|ResponseInterface
     */
    public static function handle(NodeRegistry $registry, NodeDefinition $node, string $operation, ServerRequestInterface $request, array $args): array|ResponseInterface
    {
        $ctx = self::context($registry, $node, $request, $args);

        if (!$node->availableOn($ctx->version())) {
            throw new NotFoundException(sprintf('This server (version %d) has no %s objects.', $ctx->version(), str_replace('_', ' ', $node->type)));
        }
        if ($node->extension !== null && !in_array($node->extension, self::extensions($ctx->conn), true)) {
            throw new NotFoundException(sprintf('The database has no %s extension.', $node->extension));
        }

        $controller = new ($node->controller)();
        $oid = isset($args[$node->idParam]) ? (int) $args[$node->idParam] : null;

        return match ($operation) {
            'list' => ['rows' => $controller->list($ctx)],
            'nodes' => ['nodes' => $controller->nodes($ctx)],
            'node' => ['node' => $controller->node($ctx, self::oid($oid))],
            'properties' => ['properties' => $controller->properties($ctx, self::oid($oid))],
            'create' => self::created(['node' => $controller->create($ctx, $ctx->input())]),
            'update' => ['node' => $controller->update($ctx, self::oid($oid), $ctx->input())],
            'delete' => self::deleted($controller, $ctx, self::oid($oid)),
            'sql' => ['sql' => $controller->sql($ctx, self::oid($oid))],
            'msql' => ['sql' => $controller->modifiedSql($ctx, $oid, $ctx->input())],
            'stats' => $controller->statistics($ctx, $oid),
            'dependencies' => ['dependencies' => $controller->dependencies($ctx, self::oid($oid))],
            'dependents' => ['dependents' => $controller->dependents($ctx, self::oid($oid))],
            'children' => ['children' => $controller->children($ctx, self::oid($oid))],
            default => throw new NotFoundException(),
        };
    }

    /**
     * GET /databases/{db}/nodes: every node type this server has, for the client to build the tree from.
     *
     * @param array<string, string> $args
     * @return array{nodes: list<array<string, mixed>>}
     */
    public static function catalog(NodeRegistry $registry, ServerRequestInterface $request, array $args): array
    {
        $pool = ConnectionPool::from($request);
        $serverLevel = !isset($args['db']);
        $conn = $serverLevel ? $pool->maintenance() : $pool->for(self::database($args));
        $version = $conn->version();
        $installed = null;
        $hasExtension = static function (string $name) use (&$installed, $conn): bool {
            $installed ??= self::extensions($conn);

            return in_array($name, $installed, true);
        };

        return ['nodes' => array_values(array_map(
            static fn (NodeDefinition $n): array => $n->toArray(),
            array_filter($registry->all(), static fn (NodeDefinition $n): bool => $n->availableOn($version) && $registry->isServerLevel($n) === $serverLevel && ($n->extension === null || $hasExtension($n->extension))),
        ))];
    }

    /** @return list<string> the extensions installed in the connection's database */
    private static function extensions(\PhpPgAdmin\Core\Database\Connection $conn): array
    {
        return array_column($conn->rows('SELECT extname FROM pg_catalog.pg_extension'), 'extname');
    }

    /**
     * GET /databases/{db}/resolve?type=table&schema=public&name=t: the OIDs behind a name-based
     * address, so the client can call the OID routes.
     *
     * @param array<string, string> $args
     * @return array{ids: array<string, int>}
     */
    public static function resolve(NodeRegistry $registry, ServerRequestInterface $request, array $args): array
    {
        $params = $request->getQueryParams();
        $type = (string) ($params['type'] ?? '');
        $node = $registry->find($type) ?? throw new BadRequestException(sprintf('Unknown node type "%s".', $type));
        if (!$node->supports('resolve')) {
            throw new BadRequestException(sprintf('Objects of type "%s" cannot be looked up by name.', $type));
        }
        if ($registry->isServerLevel($node) === isset($args['db'])) {
            throw new BadRequestException(sprintf('Objects of type "%s" are looked up under %s.', $type, $registry->rootPath($node)));
        }

        $ctx = self::context($registry, $node, $request, $args);
        $ids = (new ($node->controller)())->resolve($ctx, $params)
            ?? throw new NotFoundException(sprintf('No %s matches the given name.', str_replace('_', ' ', $type)));

        return ['ids' => $ids];
    }

    /** @param array<string, string> $args */
    private static function context(NodeRegistry $registry, NodeDefinition $node, ServerRequestInterface $request, array $args): NodeContext
    {
        $pool = ConnectionPool::from($request);
        // A server-level node works on the maintenance database; the others on the one in the URL.
        $conn = $registry->isServerLevel($node) ? $pool->maintenance() : $pool->for(self::database($args));

        $ids = [];
        foreach ([...$registry->ancestors($node), $node] as $level) {
            if (isset($args[$level->idParam])) {
                $ids[$level->idParam] = (int) $args[$level->idParam];
            }
        }

        return new NodeContext($node, $registry, $pool, $conn, $conn->database(), $ids, $request);
    }

    /** @param array<string, string> $args */
    private static function database(array $args): string
    {
        $database = rawurldecode((string) ($args['db'] ?? ''));

        return $database !== '' ? $database : throw new BadRequestException('A database name is required.');
    }

    private static function oid(?int $oid): int
    {
        return $oid ?? throw new BadRequestException('An object id is required.');
    }

    /** @param array<string, mixed> $payload */
    private static function created(array $payload): ResponseInterface
    {
        $response = new Response(201, ['content-type' => 'application/json']);
        $response->getBody()->write(json_encode($payload, JSON_THROW_ON_ERROR | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE));

        return $response;
    }

    /** @return array{ok: true} */
    private static function deleted(NodeController $controller, NodeContext $ctx, int $oid): array
    {
        $controller->delete($ctx, $oid, $ctx->flag('cascade'));

        return ['ok' => true];
    }
}
