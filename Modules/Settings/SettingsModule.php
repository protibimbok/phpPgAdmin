<?php

declare(strict_types=1);

namespace PhpPgAdmin\Modules\Settings;

use PhpPgAdmin\Core\Contracts\Module;
use PhpPgAdmin\Core\Contracts\ProvidesFrontendScripts;
use PhpPgAdmin\Core\Contracts\ProvidesTranslations;
use PhpPgAdmin\Core\Contracts\ProvidesViteEntries;

/**
 * Settings: phpMyAdmin's user preferences pages on the server's Settings tab. The settings
 * are those the other modules register with src/preferences.ts; the values are the role's
 * preferences, which the Auth module stores (/api/preferences).
 */
final class SettingsModule implements Module, ProvidesTranslations, ProvidesViteEntries, ProvidesFrontendScripts
{
    public function name(): string
    {
        return 'settings';
    }

    public function path(): string
    {
        return __DIR__;
    }

    public function translationsPath(): string
    {
        return 'resources/lang';
    }

    public function viteEntries(): array
    {
        return ['resources/js/app.tsx'];
    }

    public function frontendScripts(): array
    {
        return ['resources/js/app.tsx'];
    }
}
