<?php

declare(strict_types=1);

namespace PhpPgAdmin\Modules\Databases;

use PhpPgAdmin\Core\Contracts\Module;
use PhpPgAdmin\Core\Contracts\ProvidesApiRoutes;
use PhpPgAdmin\Core\Contracts\ProvidesFrontendScripts;
use PhpPgAdmin\Core\Contracts\ProvidesTranslations;
use PhpPgAdmin\Core\Contracts\ProvidesViteEntries;

/**
 * The databases of the server a session is signed in to, read from pg_database the way
 * pgAdmin fills its browser tree, and the page that lists them like phpMyAdmin's "Databases" tab.
 */
final class DatabasesModule implements Module, ProvidesApiRoutes, ProvidesTranslations, ProvidesViteEntries, ProvidesFrontendScripts
{
    public function name(): string
    {
        return 'databases';
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

    public function viteEntries(): array
    {
        return ['resources/js/app.tsx'];
    }

    /** Registers the "Databases" tab, its page and the databases in the navigation tree. */
    public function frontendScripts(): array
    {
        return ['resources/js/app.tsx'];
    }
}
