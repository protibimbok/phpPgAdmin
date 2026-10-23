<?php

declare(strict_types=1);

namespace PhpPgAdmin\Modules\I18n;

use PhpPgAdmin\Core\Contracts\Module;
use PhpPgAdmin\Core\Contracts\ProvidesApiRoutes;
use PhpPgAdmin\Core\Contracts\ProvidesTranslations;

/**
 * Exposes the locales over the API: which exist, which one the session runs in, how to change it
 * and every module's messages for a client that does not bundle them. The locale of a request is
 * picked by Http\Middleware\SetLocale, which config/modules.php puts in both route groups.
 */
final class I18nModule implements Module, ProvidesApiRoutes, ProvidesTranslations
{
    public function name(): string
    {
        return 'i18n';
    }

    public function path(): string
    {
        return __DIR__;
    }

    public function apiRoutes(): void
    {
        require __DIR__ . '/routes/api.php';
    }

    public function translationsPath(): string
    {
        return 'resources/lang';
    }
}
