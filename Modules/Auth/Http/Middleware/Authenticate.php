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

    /** The connection pool of the sign-in the PHP session holds, or null when it holds none. */
    public static function sessionPool(): ?ConnectionPool
    {
        $credentials = Credentials::fromArray((array) ($_SESSION[self::CREDENTIALS] ?? []));
        $server = self::sessionServer();

        return $credentials === null || $server === null ? null : new ConnectionPool(Connector::for($server), $credentials);
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

        // PHP holds the session file locked until the request ends, so a long statement (or one
        // stopped at a debugger breakpoint) would keep every other request of the browser
        // waiting. Only the requests that change the session keep it open; the rest read it,
        // and $_SESSION stays readable after the lock is released.
        if (!self::writesSession($request) && session_status() === PHP_SESSION_ACTIVE) {
            session_write_close();
        }

        try {
            return $handler->handle($request->withAttribute(self::USER, $user)->withAttribute(ConnectionPool::ATTRIBUTE, $pool));
        } finally {
            $pool->closeAll();
        }
    }

    /**
     * The requests that write the PHP session: signing in and out, the account and the saved
     * servers, the query tool's and the debugger's session lists, and another server's sign-in
     * for the schema diff.
     */
    private static function writesSession(ServerRequestInterface $request): bool
    {
        $path = $request->getUri()->getPath();
        $method = $request->getMethod();

        return preg_match('#/api/(?:auth|account|query/sessions)(?:/|$)#', $path) === 1
            || preg_match('#/api/schema-diff/connect$#', $path) === 1
            || preg_match('#/api/databases/[^/]+/debugger/\d+/sessions$#', $path) === 1
            || (preg_match('#/api/debugger/sessions/[0-9a-f]{24}(?:/stop)?$#', $path) === 1 && ($method === 'DELETE' || str_ends_with($path, '/stop')));
    }
}
