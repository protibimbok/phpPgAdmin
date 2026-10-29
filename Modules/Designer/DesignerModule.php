<?php

declare(strict_types=1);

namespace PhpPgAdmin\Modules\Designer;

use PhpPgAdmin\Core\Contracts\Module;
use PhpPgAdmin\Core\Contracts\ProvidesApiRoutes;
use PhpPgAdmin\Core\Contracts\ProvidesFrontendScripts;
use PhpPgAdmin\Core\Contracts\ProvidesMigrations;
use PhpPgAdmin\Core\Contracts\ProvidesTranslations;
use PhpPgAdmin\Core\Contracts\ProvidesViteEntries;

/**
 * Designer: phpMyAdmin's Designer with pgAdmin's ERD tool, a diagram of a database's tables and
 * the foreign keys between them, laid out by hand and saved as pages, from which relations are
 * made and dropped and the tables' DDL written.
 */
final class DesignerModule implements Module, ProvidesApiRoutes, ProvidesMigrations, ProvidesTranslations, ProvidesViteEntries, ProvidesFrontendScripts
{
    public function name(): string
    {
        return 'designer';
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
