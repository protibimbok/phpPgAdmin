<?php

declare(strict_types=1);

namespace PhpPgAdmin\Core\Nodes;

use PhpPgAdmin\Core\Database\Connection;
use PhpPgAdmin\Core\Database\ConnectionPool;
use PhpPgAdmin\Core\Database\Result;
use PhpPgAdmin\Core\Facades\Sql;
use Psr\Http\Message\ServerRequestInterface;

/**
 * What one node operation works with: the connection to the database the request addresses,
 * the server version the templates are picked for, the OIDs from the route (did, scid, tid…)
 * and the node's own template folder.
 */
final class NodeContext
{
    private ?int $did = null;

    /**
     * @param array<string, int> $ids the OID route parameters, by pgAdmin's names: scid, tid…
     */
    public function __construct(
        public readonly NodeDefinition $node,
        public readonly NodeRegistry $registry,
        public readonly ConnectionPool $pool,
        public readonly Connection $conn,
        public readonly string $database,
        public readonly array $ids,
        public readonly ServerRequestInterface $request,
    ) {
    }

    public function version(): int
    {
        return $this->conn->version();
    }

    /**
     * The OID of the database the context works in, which pgAdmin's templates read as "did".
     * For the database node itself the route's own "did" is the one meant, and it wins.
     */
    public function did(): int
    {
        return $this->ids['did'] ?? ($this->did ??= (int) $this->conn->scalar('SELECT oid FROM pg_catalog.pg_database WHERE datname = current_database()'));
    }

    /** One of the route's OIDs, "scid"; null when the route has none of that name. */
    public function id(string $name): ?int
    {
        return $this->ids[$name] ?? null;
    }

    /**
     * Render one of the node's templates for this server, with the connection and the route's
     * OIDs in scope along with the given variables.
     *
     * @param array<string, mixed> $vars
     */
    public function render(string $file, array $vars = []): string
    {
        return Sql::render($this->node->templateDir(), $file, $this->scope($vars), $this->version());
    }

    /** Render a template of another node's folder, "columns/properties.sql". */
    public function renderFrom(string $templateDir, string $file, array $vars = []): string
    {
        return Sql::render($templateDir, $file, $this->scope($vars), $this->version());
    }

    /**
     * The variables every template sees: the route's OIDs, the database's OID when the node is
     * inside one, the connection, then the caller's own. "did" is left to the caller for a
     * server-level node, where it names a database rather than the current one.
     *
     * @param array<string, mixed> $vars
     * @return array<string, mixed>
     */
    private function scope(array $vars): array
    {
        $scope = [...$this->ids, 'conn' => $this->conn];
        if (!$this->registry->isServerLevel($this->node)) {
            $scope['did'] = $this->did();
        }

        return [...$scope, ...$vars];
    }

    public function has(string $file): bool
    {
        return Sql::has($this->node->templateDir(), $file, $this->version());
    }

    /**
     * Render and run one of the node's templates.
     *
     * @param array<string, mixed> $vars
     */
    public function query(string $file, array $vars = []): Result
    {
        return $this->conn->query($this->render($file, $vars));
    }

    /** @return list<array<string, mixed>> */
    public function rows(string $file, array $vars = []): array
    {
        return $this->query($file, $vars)->rows();
    }

    /** @return array<string, mixed>|null */
    public function row(string $file, array $vars = []): ?array
    {
        return $this->query($file, $vars)->row();
    }

    /**
     * The request's JSON body as an array.
     *
     * @return array<string, mixed>
     */
    public function input(): array
    {
        $body = $this->request->getParsedBody();

        return is_array($body) ? $body : [];
    }

    /** @return array<string, mixed> */
    public function queryParams(): array
    {
        return $this->request->getQueryParams();
    }

    public function flag(string $name): bool
    {
        $value = $this->request->getQueryParams()[$name] ?? null;

        return $value !== null && $value !== '' && $value !== '0' && $value !== 'false';
    }
}
