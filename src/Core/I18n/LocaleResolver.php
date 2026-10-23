<?php

declare(strict_types=1);

namespace PhpPgAdmin\Core\I18n;

use Psr\Http\Message\ServerRequestInterface;

/**
 * Picks the locale a request runs in, the way phpMyAdmin does: an explicit "?lang=" wins, then
 * the choice saved in the session, then the cookie, then the browser's Accept-Language header,
 * and finally the default.
 */
final class LocaleResolver
{
    public const string QUERY = 'lang';

    public const string SESSION_KEY = 'locale';

    public const string COOKIE = 'pga_lang';

    public function __construct(private readonly Translator $translator)
    {
    }

    public function resolve(ServerRequestInterface $request): Locale
    {
        return $this->fromQuery($request)
            ?? $this->fromSession()
            ?? $this->fromCookie($request)
            ?? $this->fromAcceptLanguage($request->getHeaderLine('Accept-Language'))
            ?? $this->translator->locale();
    }

    /** The locale "?lang=" asks for, when it asks for a supported one. */
    public function fromQuery(ServerRequestInterface $request): ?Locale
    {
        $code = $request->getQueryParams()[self::QUERY] ?? null;

        return is_string($code) ? $this->translator->find($code) : null;
    }

    public function fromSession(): ?Locale
    {
        if (session_status() !== PHP_SESSION_ACTIVE) {
            return null;
        }

        $code = $_SESSION[self::SESSION_KEY] ?? null;

        return is_string($code) ? $this->translator->find($code) : null;
    }

    public function fromCookie(ServerRequestInterface $request): ?Locale
    {
        $code = $request->getCookieParams()[self::COOKIE] ?? null;

        return is_string($code) ? $this->translator->find($code) : null;
    }

    /**
     * The first supported locale among the header's languages, best quality first.
     */
    public function fromAcceptLanguage(string $header): ?Locale
    {
        if (trim($header) === '') {
            return null;
        }

        $candidates = [];
        foreach (explode(',', $header) as $position => $part) {
            $pieces = array_map('trim', explode(';', $part));
            $tag = array_shift($pieces);
            if ($tag === '' || $tag === '*') {
                continue;
            }

            $quality = 1.0;
            foreach ($pieces as $parameter) {
                if (preg_match('/^q=([0-9]*\.?[0-9]+)$/i', $parameter, $m)) {
                    $quality = (float) $m[1];
                }
            }

            if ($quality > 0) {
                $candidates[] = [$quality, -$position, $tag];
            }
        }

        rsort($candidates);

        foreach ($candidates as [, , $tag]) {
            $locale = $this->translator->find($tag);
            if ($locale !== null) {
                return $locale;
            }
        }

        return null;
    }
}
