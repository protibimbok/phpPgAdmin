<?php

declare(strict_types=1);

namespace PhpPgAdmin\Modules\Sql;

use PhpPgAdmin\Core\Contracts\Module;
use PhpPgAdmin\Core\Contracts\ProvidesApiRoutes;
use PhpPgAdmin\Core\Contracts\ProvidesFrontendScripts;
use PhpPgAdmin\Core\Contracts\ProvidesMigrations;
use PhpPgAdmin\Core\Contracts\ProvidesTranslations;
use PhpPgAdmin\Core\Contracts\ProvidesViteEntries;

/**
 * Running SQL: pgAdmin's query tool behind phpMyAdmin's SQL page and Browse grid. The query
 * endpoint splits a batch, runs it statement by statement, paginates a lone SELECT, and
 * describes the columns well enough for the client to know whether the rows can be edited.
 */
final class SqlModule implements Module, ProvidesApiRoutes, ProvidesMigrations, ProvidesTranslations, ProvidesViteEntries, ProvidesFrontendScripts
{
    public function name(): string
    {
        return 'sql';
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
