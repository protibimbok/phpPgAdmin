<?php

declare(strict_types=1);

namespace PhpPgAdmin\Modules\I18n\Http\Controllers;

use League\Route\Http\Exception\NotFoundException;
use League\Route\Http\Exception\UnprocessableEntityException;
use PhpPgAdmin\Core\Facades\Lang;
use PhpPgAdmin\Core\I18n\Locale;
use PhpPgAdmin\Core\I18n\LocaleResolver;
use PhpPgAdmin\Modules\Auth\Preferences;
use Psr\Http\Message\ServerRequestInterface;

final class LocaleController
{
    /**
     * The supported locales and the one this request runs in.
     *
     * @return array{current: string, locales: list<array{code: string, name: string, native: string, dir: string}>}
     */
    public function index(ServerRequestInterface $request): array
    {
        return [
            'current' => Lang::locale()->code,
            'locales' => array_values(array_map(static fn (Locale $locale): array => $locale->toArray(), Lang::locales())),
        ];
    }

    /**
     * Remember the given locale for the session. SetLocale saves it to the cookie as well on the way out.
     *
     * @return array{locale: array{code: string, name: string, native: string, dir: string}}
     */
    public function update(ServerRequestInterface $request): array
    {
        $input = (array) ($request->getParsedBody() ?? []);
        $code = $input['locale'] ?? null;

        $locale = is_string($code) ? Lang::find($code) : null;
        if ($locale === null) {
            throw new UnprocessableEntityException(__('i18n::errors.unsupported_locale', ['locale' => is_scalar($code) ? (string) $code : '']));
        }

        Lang::setLocale($locale);
        if (session_status() === PHP_SESSION_ACTIVE) {
            $_SESSION[LocaleResolver::SESSION_KEY] = $locale->code;
        }

        // A signed-in role keeps the choice across sessions, in the application storage.
        Preferences::forSession()?->set(Preferences::LOCALE, $locale->code);

        return ['locale' => $locale->toArray()];
    }

    /**
     * Every module's messages for a locale, keyed by module name.
     *
     * @return array<string, array<string, mixed>>
     */
    public function messages(ServerRequestInterface $request, array $args): array
    {
        $locale = Lang::find((string) ($args['locale'] ?? ''))
            ?? throw new NotFoundException(__('i18n::errors.unsupported_locale', ['locale' => (string) ($args['locale'] ?? '')]));

        return Lang::translator()->messages($locale);
    }
}
