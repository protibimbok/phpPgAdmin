<?php

declare(strict_types=1);

namespace PhpPgAdmin\Modules\I18n\Http\Middleware;

use PhpPgAdmin\Core\Facades\Lang;
use PhpPgAdmin\Core\I18n\LocaleResolver;
use Psr\Http\Message\ResponseInterface;
use Psr\Http\Message\ServerRequestInterface;
use Psr\Http\Server\MiddlewareInterface;
use Psr\Http\Server\RequestHandlerInterface;

/**
 * Runs the request in the locale LocaleResolver picks. An explicit "?lang=" is remembered in the
 * session, and, like phpMyAdmin's pma_lang, the locale the response ends up in is saved to a cookie
 * so a new session starts in the same language.
 */
final class SetLocale implements MiddlewareInterface
{
    /** One year, like phpMyAdmin's cookies. */
    private const int COOKIE_LIFETIME = 365 * 24 * 60 * 60;

    public function process(ServerRequestInterface $request, RequestHandlerInterface $handler): ResponseInterface
    {
        $resolver = new LocaleResolver(Lang::translator());

        $locale = $resolver->resolve($request);
        Lang::setLocale($locale);

        if ($resolver->fromQuery($request) !== null && session_status() === PHP_SESSION_ACTIVE) {
            $_SESSION[LocaleResolver::SESSION_KEY] = $locale->code;
        }

        $response = $handler->handle($request->withAttribute('locale', $locale));

        // The handler may have switched the locale (PUT /api/i18n/locale), so read it again.
        $code = Lang::locale()->code;
        $response = $response->withHeader('Content-Language', $code);

        if (($request->getCookieParams()[LocaleResolver::COOKIE] ?? null) !== $code) {
            $response = $response->withAddedHeader('Set-Cookie', $this->cookie($code, $request));
        }

        return $response;
    }

    private function cookie(string $code, ServerRequestInterface $request): string
    {
        $attributes = [
            LocaleResolver::COOKIE . '=' . rawurlencode($code),
            'Path=/',
            'Max-Age=' . self::COOKIE_LIFETIME,
            'SameSite=Lax',
        ];

        if ($request->getUri()->getScheme() === 'https') {
            $attributes[] = 'Secure';
        }

        return implode('; ', $attributes);
    }
}
