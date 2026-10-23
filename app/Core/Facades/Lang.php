<?php

declare(strict_types=1);

namespace PhpPgAdmin\Core\Facades;

use LogicException;
use PhpPgAdmin\Core\I18n\Locale;
use PhpPgAdmin\Core\I18n\Translator;

/**
 * Static access to the application's translator, so any class can read a message
 * without being handed the translator:
 *
 *     Lang::get('auth::login.title');   // or the __() helper
 *     Lang::locale()->isRtl();
 */
final class Lang
{
    private static ?Translator $translator = null;

    /** The kernel calls this once; tests may call it to swap in a fresh translator. */
    public static function swap(?Translator $translator): void
    {
        self::$translator = $translator;
    }

    public static function translator(): Translator
    {
        return self::$translator ?? throw new LogicException(
            'No translator has been set. Boot the application through ' . \PhpPgAdmin\App::class . '::create() first.',
        );
    }

    /** @param array<string, scalar|\Stringable|null> $replace */
    public static function get(string $key, array $replace = [], Locale|string|null $locale = null): string
    {
        return self::translator()->get($key, $replace, $locale);
    }

    public static function has(string $key, Locale|string|null $locale = null): bool
    {
        return self::translator()->has($key, $locale);
    }

    public static function locale(): Locale
    {
        return self::translator()->locale();
    }

    public static function setLocale(Locale|string $locale): void
    {
        self::translator()->setLocale($locale);
    }

    /** @return array<string, Locale> keyed by code */
    public static function locales(): array
    {
        return self::translator()->locales();
    }

    public static function find(string $code): ?Locale
    {
        return self::translator()->find($code);
    }

    public static function isSupported(string $code): bool
    {
        return self::translator()->isSupported($code);
    }
}
