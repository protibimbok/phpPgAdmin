<?php

declare(strict_types=1);

namespace PhpPgAdmin\Modules\Auth\Http\Middleware;

use Psr\Http\Message\ResponseInterface;
use Psr\Http\Message\ServerRequestInterface;
use Psr\Http\Server\MiddlewareInterface;
use Psr\Http\Server\RequestHandlerInterface;

/**
 * Starts PHP's session. The session holds the role's password, so its cookie is kept from
 * scripts (HttpOnly), from other sites' requests (SameSite=Lax) and, on HTTPS, from plain HTTP
 * (Secure, or when php.ini sets session.cookie_secure); an id the server did not issue is not adopted.
 */
final class StartSession implements MiddlewareInterface
{
    public function process(ServerRequestInterface $request, RequestHandlerInterface $handler): ResponseInterface
    {
        if (PHP_SAPI !== 'cli' && session_status() === PHP_SESSION_NONE) {
            session_start([
                'cookie_httponly' => true,
                'cookie_samesite' => 'Lax',
                // Behind a proxy that ends TLS the request reads as http; php.ini can still ask for it.
                'cookie_secure' => $request->getUri()->getScheme() === 'https' || filter_var(ini_get('session.cookie_secure'), FILTER_VALIDATE_BOOL),
                'use_strict_mode' => true,
            ]);
        }

        return $handler->handle($request);
    }
}
