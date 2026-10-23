<?php

declare(strict_types=1);

use PhpPgAdmin\Core\Facades\Lang;
use PhpPgAdmin\Core\I18n\Locale;

if (!function_exists('__')) {
    /**
     * Translate a message: __('auth::login.title'), __('app::items', ['count' => 3]).
     *
     * @param array<string, scalar|\Stringable|null> $replace
     */
    function __(string $key, array $replace = [], Locale|string|null $locale = null): string
    {
        return Lang::get($key, $replace, $locale);
    }
}

if (!function_exists('trans')) {
    /**
     * Alias of __().
     *
     * @param array<string, scalar|\Stringable|null> $replace
     */
    function trans(string $key, array $replace = [], Locale|string|null $locale = null): string
    {
        return Lang::get($key, $replace, $locale);
    }
}
