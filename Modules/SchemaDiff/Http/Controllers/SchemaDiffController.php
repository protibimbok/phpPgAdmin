<?php

declare(strict_types=1);

namespace PhpPgAdmin\Modules\SchemaDiff\Http\Controllers;

use League\Route\Http\Exception\BadRequestException;
use League\Route\Http\Exception\NotFoundException;
use PhpPgAdmin\Core\Database\ConnectionException;
use PhpPgAdmin\Core\Database\ConnectionPool;
use PhpPgAdmin\Core\Database\Connector;
use PhpPgAdmin\Core\Database\Server;
use PhpPgAdmin\Core\Http\ApiException;
use PhpPgAdmin\Core\Nodes\Catalog;
use PhpPgAdmin\Modules\Auth\Http\Controllers\AuthController;
use PhpPgAdmin\Modules\Auth\Http\Middleware\Authenticate;
use PhpPgAdmin\Modules\Auth\Servers;
use PhpPgAdmin\Modules\SchemaDiff\Diff\DatabaseComparer;
use PhpPgAdmin\Modules\SchemaDiff\Diff\DdlNormalizer;
use PhpPgAdmin\Modules\SchemaDiff\Diff\SchemaComparer;
use PhpPgAdmin\Modules\SchemaDiff\Diff\SchemaSnapshot;
use Psr\Http\Message\ServerRequestInterface;

/**
 * The Schema diff page's backend, after pgAdmin's schema_diff views: the servers, databases and
 * schemas to choose from (GET /api/schema-diff/options), signing in to another saved server
 * (POST …/connect), the comparison (POST …/compare), one object's DDL on both sides with the
 * difference (POST …/ddl), and the script for the objects chosen (POST …/script).
 *
 * Each request names the source and the target, {server, database, schema}, and the options:
 * ignore_owner, ignore_grants, ignore_tablespace, ignore_whitespace. The server is a saved
 * server's id, null for the one the session is signed in to; another one must have been signed
 * in to through …/connect first. With no schema on either side the whole databases are
 * compared, their own objects and then their schemas by name, and each object names its schema.
 */
final class SchemaDiffController
{
    /** @var list<ConnectionPool> pools to other servers, closed when the request ends */
    private array $opened = [];

    /**
     * The servers to compare across, and the databases and schemas of the one asked for:
     * ?server=<id>&database=<name>. A saved server the session has not signed in to has
     * needs_login set and no databases.
     *
     * @return array{servers: list<array<string, mixed>>, databases: list<string>, schemas: list<string>|null, needs_login?: bool}
     */
    public function options(ServerRequestInterface $request): array
    {
        $query = $request->getQueryParams();
        $database = (string) ($query['database'] ?? '');
        $servers = $this->servers();
        try {
            $pool = $this->pool($request, $query['server'] ?? null);
        } catch (ApiException $e) {
            if ($e->httpStatus() !== 428) {
                throw $e;
            }

            return ['servers' => $servers, 'databases' => [], 'schemas' => null, 'needs_login' => true];
        }

        try {
            return [
                'servers' => $servers,
                'databases' => array_column($pool->maintenance()->rows('SELECT datname FROM pg_catalog.pg_database WHERE datallowconn AND NOT datistemplate AND has_database_privilege(datname, \'CONNECT\') ORDER BY datname'), 'datname'),
                'schemas' => $database === '' ? null : Catalog::schemas($pool->for($database)),
            ];
        } finally {
            $this->close();
        }
    }

    /**
     * Sign in to another saved server for the comparison: {server, username, password}. Only
     * saved servers can be named, by id; the credentials are kept in the session until logout.
     *
     * @return array{ok: true}
     */
    public function connect(ServerRequestInterface $request): array
    {
        $body = (array) ($request->getParsedBody() ?? []);
        $server = $this->savedServer($body['server'] ?? null) ?? throw new BadRequestException('Choose a saved server.');
        $username = trim((string) ($body['username'] ?? ''));
        $password = (string) ($body['password'] ?? '');
        if ($username === '') {
            throw new BadRequestException(__('auth::errors.credentials_required'));
        }
        // The sign-in's rules hold for the other server's sign-in too (extra_login_security).
        if (AuthController::disallowed($username, $password)) {
            throw new ApiException(403, __('auth::errors.login_disallowed'));
        }

        try {
            [$connection, $credentials] = Connector::for($server)->login($username, $password);
        } catch (ConnectionException $e) {
            // Not 401, which the client takes as the end of its own session.
            throw new ApiException($e->credentialsRejected() ? 403 : 503, $e->responseMessage());
        }
        $connection->close();
        Authenticate::rememberOther($server, $credentials);

        return ['ok' => true];
    }

    /** @return array{results: list<array<string, mixed>>} */
    public function compare(ServerRequestInterface $request): array
    {
        try {
            return ['results' => $this->comparer($request)->compare()];
        } finally {
            $this->close();
        }
    }

    /** @return array{source_ddl: string, target_ddl: string, diff_ddl: string} */
    public function ddl(ServerRequestInterface $request): array
    {
        $body = (array) ($request->getParsedBody() ?? []);
        try {
            $comparer = $this->comparer($request);
            if ($comparer instanceof DatabaseComparer) {
                [$schema, $type, $source, $target] = self::item($body, true);

                return $comparer->ddl($schema, $type, $source, $target);
            }
            [, $type, $source, $target] = self::item($body, false);

            return $comparer->ddl($type, $source, $target);
        } finally {
            $this->close();
        }
    }

    /** @return array{script: string} */
    public function script(ServerRequestInterface $request): array
    {
        $body = (array) ($request->getParsedBody() ?? []);
        try {
            $comparer = $this->comparer($request);
            $whole = $comparer instanceof DatabaseComparer;
            $items = [];
            foreach (is_array($body['items'] ?? null) ? $body['items'] : [] as $entry) {
                [$schema, $type, $source, $target] = self::item(is_array($entry) ? $entry : [], $whole);
                $items[] = $whole
                    ? ['schema' => $schema, 'type' => $type, 'source_oid' => $source, 'target_oid' => $target]
                    : ['type' => $type, 'source_oid' => $source, 'target_oid' => $target];
            }
            if ($items === []) {
                throw new BadRequestException('Select the objects to write the script for.');
            }

            return ['script' => $comparer->script($items)];
        } finally {
            $this->close();
        }
    }

    private function comparer(ServerRequestInterface $request): SchemaComparer|DatabaseComparer
    {
        $body = (array) ($request->getParsedBody() ?? []);
        [$sourceServer, $sourceDb, $sourceSchema] = self::side($body, 'source');
        [$targetServer, $targetDb, $targetSchema] = self::side($body, 'target');
        if (($sourceSchema === '') !== ($targetSchema === '')) {
            throw new BadRequestException('Choose a schema on both sides, or on neither to compare the whole databases.');
        }
        $sourcePool = $this->pool($request, $sourceServer);
        $targetPool = $this->pool($request, $targetServer);
        if ($sourcePool === $targetPool && $sourceDb === $targetDb && $sourceSchema === $targetSchema) {
            throw new BadRequestException($sourceSchema === '' ? 'The source and the target are the same database.' : 'The source and the target are the same schema.');
        }
        $flag = static fn (string $key): bool => filter_var($body[$key] ?? false, FILTER_VALIDATE_BOOL);
        $flags = ['ignore_owner' => $flag('ignore_owner'), 'ignore_grants' => $flag('ignore_grants'), 'ignore_tablespace' => $flag('ignore_tablespace'), 'ignore_whitespace' => $flag('ignore_whitespace')];

        if ($sourceSchema === '') {
            return new DatabaseComparer($sourcePool, $sourcePool->for($sourceDb), $targetPool, $targetPool->for($targetDb), $request, $flags);
        }

        return new SchemaComparer(
            new SchemaSnapshot($sourcePool, $sourcePool->for($sourceDb), $sourceSchema, $request),
            new SchemaSnapshot($targetPool, $targetPool->for($targetDb), $targetSchema, $request),
            new DdlNormalizer($sourceSchema, $targetSchema, ...array_values($flags)),
        );
    }

    /**
     * The pool for a side's server: the request's own for the session's server, one opened with
     * the credentials …/connect kept for another saved server (428 when there are none).
     */
    private function pool(ServerRequestInterface $request, mixed $serverId): ConnectionPool
    {
        $session = Authenticate::sessionServer();
        if ($serverId === null || $serverId === '' || (is_numeric($serverId) && (int) $serverId === $session?->id)) {
            return ConnectionPool::from($request);
        }
        $server = $this->savedServer($serverId) ?? throw new NotFoundException(__('auth::errors.unknown_server'));
        $credentials = Authenticate::otherCredentials($server) ?? throw new ApiException(428, sprintf('Sign in to %s first.', $server->name ?? $server->key()), ['needs_login' => true]);
        foreach ($this->opened as [$id, $pool]) {
            if ($id === $server->id) {
                return $pool;
            }
        }
        $pool = new ConnectionPool(Connector::for($server), $credentials);
        // Credentials that no longer work (a changed password, a dropped role) ask for the
        // sign-in again: their 401 would end the page's own session in the client.
        try {
            $pool->maintenance();
        } catch (ConnectionException $e) {
            if (!$e->credentialsRejected()) {
                throw new ApiException(503, $e->responseMessage());
            }

            throw new ApiException(428, sprintf('Sign in to %s again: %s', $server->name ?? $server->key(), $e->responseMessage()), ['needs_login' => true]);
        }
        $this->opened[] = [$server->id, $pool];

        return $pool;
    }

    private function savedServer(mixed $id): ?Server
    {
        return is_numeric($id) && (int) $id > 0 ? Servers::make()->find((int) $id) : null;
    }

    /** @return list<array{id: int|null, name: string, current: bool, connected: bool}> the session's server first, then the other saved ones */
    private function servers(): array
    {
        $session = Authenticate::sessionServer();
        $label = static fn (Server $s): string => $s->name ?? $s->key();
        $list = $session === null ? [] : [['id' => $session->id, 'name' => $label($session), 'current' => true, 'connected' => true]];
        foreach (Servers::make()->all() as $server) {
            if ($server->id !== $session?->id) {
                $list[] = ['id' => $server->id, 'name' => $label($server), 'current' => false, 'connected' => Authenticate::otherCredentials($server) !== null];
            }
        }

        return $list;
    }

    private function close(): void
    {
        foreach ($this->opened as [, $pool]) {
            $pool->closeAll();
        }
        $this->opened = [];
    }

    /** @return array{0: mixed, 1: string, 2: string} the server, database and schema of one side ('' for the whole database) */
    private static function side(array $body, string $key): array
    {
        $side = is_array($body[$key] ?? null) ? $body[$key] : [];
        $database = trim((string) ($side['database'] ?? ''));
        $schema = trim((string) ($side['schema'] ?? ''));
        if ($database === '') {
            throw new BadRequestException(sprintf('Choose the %s database.', $key));
        }

        return [$side['server'] ?? null, $database, $schema];
    }

    /** @return array{0: string|null, 1: string, 2: int|null, 3: int|null} an object: its schema, its type and its OID on each side */
    private static function item(array $entry, bool $whole): array
    {
        $type = (string) ($entry['type'] ?? '');
        $schema = $whole && is_string($entry['schema'] ?? null) && $entry['schema'] !== '' ? $entry['schema'] : null;
        if (!$whole && !in_array($type, SchemaSnapshot::TYPES, true)) {
            throw new BadRequestException(sprintf('"%s" is not a type the schema diff compares.', $type));
        }
        $oid = static fn (mixed $v): ?int => is_numeric($v) && (int) $v > 0 ? (int) $v : null;
        $source = $oid($entry['source_oid'] ?? null);
        $target = $oid($entry['target_oid'] ?? null);
        if ($source === null && $target === null) {
            throw new BadRequestException('The object is in neither schema.');
        }

        return [$schema, $type, $source, $target];
    }
}
