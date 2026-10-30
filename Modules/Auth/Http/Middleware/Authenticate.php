<?php

declare(strict_types=1);

namespace PhpPgAdmin\Modules\Auth\Http\Middleware;

use League\Route\Http\Exception\UnauthorizedException;
use PhpPgAdmin\Core\Database\ConnectionPool;
use PhpPgAdmin\Core\Database\Connector;
use PhpPgAdmin\Core\Database\Credentials;
use PhpPgAdmin\Core\Database\Server;
use Psr\Http\Message\ResponseInterface;
use Psr\Http\Message\ServerRequestInterface;
use Psr\Http\Server\MiddlewareInterface;
use Psr\Http\Server\RequestHandlerInterface;

/**
 * Lets only signed-in sessions through, with the "user" attribute and a connection pool for
 * the session's role set on the request. Controllers take connections from
 * ConnectionPool::from($request); the pool is closed when the request ends.
 */
final class Authenticate implements MiddlewareInterface
{
    public const string USER = 'user';

    public const string CREDENTIALS = 'credentials';

    public const string SERVER = 'server';

    /**
     * Credentials for other saved servers, by server id, which a page that works across
     * servers (the schema diff) signs in to besides the session's own. Cleared at login and
     * logout with the rest of the session's sign-in.
     */
    public const string OTHER_CREDENTIALS = 'other_credentials';

    /** Keep the credentials a sign-in to another saved server succeeded with. */
    public static function rememberOther(Server $server, Credentials $credentials): void
    {
        if ($server->id !== null) {
            $_SESSION[self::OTHER_CREDENTIALS][$server->id] = $credentials->toArray();
        }
    }

    /** The credentials the session signed in to another saved server with, or null. */
    public static function otherCredentials(Server $server): ?Credentials
    {
        $data = $server->id === null ? null : ($_SESSION[self::OTHER_CREDENTIALS][$server->id] ?? null);

        return is_array($data) ? Credentials::fromArray($data) : null;
    }

    /** The server the session is signed in to, or null when it is not. */
    public static function sessionServer(): ?Server
    {
        $data = $_SESSION[self::SERVER] ?? null;
        if (!is_array($data)) {
            return null;
        }

        try {
            return Server::fromArray($data, true);
        } catch (\InvalidArgumentException) {
            return null;
        }
    }

    public function process(ServerRequestInterface $request, RequestHandlerInterface $handler): ResponseInterface
    {
        $user = $_SESSION[self::USER] ?? null;
        $credentials = Credentials::fromArray((array) ($_SESSION[self::CREDENTIALS] ?? []));
        $server = self::sessionServer();

        if (!is_array($user) || $credentials === null || $server === null) {
            throw new UnauthorizedException();
        }

        $pool = new ConnectionPool(Connector::for($server), $credentials);

        try {
            return $handler->handle($request->withAttribute(self::USER, $user)->withAttribute(ConnectionPool::ATTRIBUTE, $pool));
        } finally {
            $pool->closeAll();
        }
    }
}
