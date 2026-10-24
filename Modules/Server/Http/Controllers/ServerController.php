<?php

declare(strict_types=1);

namespace PhpPgAdmin\Modules\Server\Http\Controllers;

use PhpPgAdmin\App;
use PhpPgAdmin\Core\Database\ConnectionPool;
use Psr\Http\Message\ServerRequestInterface;

final class ServerController
{
    /**
     * What phpMyAdmin's home page reports about the server, from the session's own connection:
     * version, role, server encoding and whether the connection is encrypted.
     */
    private const string INFO = <<<'SQL'
        SELECT pg_catalog.current_setting('server_version') AS version,
               current_user AS "user",
               pg_catalog.current_setting('server_encoding') AS encoding,
               (SELECT s.ssl FROM pg_catalog.pg_stat_ssl s WHERE s.pid = pg_catalog.pg_backend_pid()) AS ssl
        SQL;

    /**
     * @return array{server: array<string, mixed>, web: array<string, mixed>, app: array<string, mixed>}
     */
    public function info(ServerRequestInterface $request): array
    {
        $pool = ConnectionPool::from($request);
        $connector = $pool->connector();
        $connection = $pool->maintenance();

        /** @var array{version: string, user: string, encoding: string, ssl: bool|null} $row */
        $row = $connection->row(self::INFO);
        $serverParams = $request->getServerParams();

        return [
            'server' => [
                'host' => $connector->host,
                'port' => $connector->port,
                // libpq connects over a UNIX socket when the host is a directory, otherwise over TCP/IP.
                'socket' => str_starts_with($connector->host, '/'),
                'type' => 'PostgreSQL',
                'version' => $row['version'],
                'user' => $row['user'],
                'encoding' => $row['encoding'],
                'ssl' => $row['ssl'] === null ? null : (bool) $row['ssl'],
                'database' => $connection->database(),
            ],
            'web' => [
                'software' => isset($serverParams['SERVER_SOFTWARE']) ? (string) $serverParams['SERVER_SOFTWARE'] : null,
                'client' => 'libpq ' . $connection->clientVersion(),
                'extensions' => ['pgsql'],
                'php' => PHP_VERSION,
            ],
            'app' => [
                'version' => App::VERSION,
            ],
        ];
    }
}
