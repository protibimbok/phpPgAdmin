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

    /** The server the session is signed in to, or null when it is not. */
    public static function sessionServer(): ?Server
    {
        $data = $_SESSION[self::SERVER] ?? null;
        if (!is_array($data)) {
            return null;
        }

        try {
            return Server::fromArray($data);
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
