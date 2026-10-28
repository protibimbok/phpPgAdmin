<?php

declare(strict_types=1);

namespace PhpPgAdmin\Modules\Export;

use PhpPgAdmin\Core\Contracts\Module;
use PhpPgAdmin\Core\Contracts\ProvidesApiRoutes;
use PhpPgAdmin\Core\Contracts\ProvidesFrontendScripts;
use PhpPgAdmin\Core\Contracts\ProvidesMigrations;
use PhpPgAdmin\Core\Contracts\ProvidesTranslations;
use PhpPgAdmin\Core\Contracts\ProvidesViteEntries;

/**
 * Export: pgAdmin's backup tool behind phpMyAdmin's Export pages. pg_dumpall exports the
 * server, pg_dump a database, a schema or a relation, in plain SQL or as a custom or tar
 * archive, streamed to the browser as the program writes it; the pages' option sets can be
 * kept as export templates.
 */
final class ExportModule implements Module, ProvidesApiRoutes, ProvidesMigrations, ProvidesTranslations, ProvidesViteEntries, ProvidesFrontendScripts
{
    public function name(): string
    {
        return 'export';
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
