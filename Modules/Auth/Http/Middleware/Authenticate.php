<?php

declare(strict_types=1);

namespace PhpPgAdmin\Modules\Auth\Http\Middleware;

use League\Route\Http\Exception\UnauthorizedException;
use PhpPgAdmin\Core\Database\Credentials;
use Psr\Http\Message\ResponseInterface;
use Psr\Http\Message\ServerRequestInterface;
use Psr\Http\Server\MiddlewareInterface;
use Psr\Http\Server\RequestHandlerInterface;

/**
 * Lets only signed-in sessions through, with the "user" and "credentials" attributes set on
 * the request. Controllers open their connections with Connector::connect($credentials).
 */
final class Authenticate implements MiddlewareInterface
{
    public const string USER = 'user';

    public const string CREDENTIALS = 'credentials';

    public function process(ServerRequestInterface $request, RequestHandlerInterface $handler): ResponseInterface
    {
        $user = $_SESSION[self::USER] ?? null;
        $credentials = Credentials::fromArray((array) ($_SESSION[self::CREDENTIALS] ?? []));

        if (!is_array($user) || $credentials === null) {
            throw new UnauthorizedException();
        }

        return $handler->handle($request->withAttribute(self::USER, $user)->withAttribute(self::CREDENTIALS, $credentials));
    }
}
