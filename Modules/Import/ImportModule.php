<?php

declare(strict_types=1);

namespace PhpPgAdmin\Modules\Import;

use PhpPgAdmin\Core\Contracts\Module;
use PhpPgAdmin\Core\Contracts\ProvidesApiRoutes;
use PhpPgAdmin\Core\Contracts\ProvidesFrontendScripts;
use PhpPgAdmin\Core\Contracts\ProvidesMigrations;
use PhpPgAdmin\Core\Contracts\ProvidesTranslations;
use PhpPgAdmin\Core\Contracts\ProvidesViteEntries;

/**
 * Import: pgAdmin's restore tool behind phpMyAdmin's Import pages. An SQL file runs through
 * psql and a pg_dump archive through pg_restore, into the server, a database or a schema, as a
 * background process whose output the page follows until it ends.
 */
final class ImportModule implements Module, ProvidesApiRoutes, ProvidesMigrations, ProvidesTranslations, ProvidesViteEntries, ProvidesFrontendScripts
{
    public function name(): string
    {
        return 'import';
    }

    public function path(): string
    {
        return __DIR__;
    }

    public function apiRoutes(): void
    {
        require __DIR__ . '/routes/api.php';
    }

    public function migrationsPath(): string
    {
        return 'database/migrations';
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
