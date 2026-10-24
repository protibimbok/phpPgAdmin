<?php

declare(strict_types=1);

namespace PhpPgAdmin\Modules\Server\Http\Controllers;

use League\Route\Http\Exception as HttpException;
use PDO;
use PhpPgAdmin\App;
use PhpPgAdmin\Core\Database\ConnectionException;
use PhpPgAdmin\Core\Database\Connector;
use PhpPgAdmin\Core\Database\Credentials;
use PhpPgAdmin\Modules\Auth\Http\Middleware\Authenticate;
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
        /** @var Credentials $credentials */
        $credentials = $request->getAttribute(Authenticate::CREDENTIALS);
        $connector = Connector::fromConfig();

        try {
            $connection = $connector->connect($credentials);
        } catch (ConnectionException $e) {
            throw new HttpException($e->httpStatus(), $e->getMessage());
        }

        /** @var array{version: string, user: string, encoding: string, ssl: bool|null} $row */
        $row = $connection->query(self::INFO)->fetch();
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
                'database' => $credentials->database,
            ],
            'web' => [
                'software' => isset($serverParams['SERVER_SOFTWARE']) ? (string) $serverParams['SERVER_SOFTWARE'] : null,
                'client' => 'libpq ' . (string) $connection->getAttribute(PDO::ATTR_CLIENT_VERSION),
                'extensions' => ['pdo_pgsql'],
                'php' => PHP_VERSION,
            ],
            'app' => [
                'version' => App::VERSION,
            ],
        ];
    }
}
