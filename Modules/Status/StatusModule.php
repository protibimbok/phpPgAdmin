<?php

declare(strict_types=1);

namespace PhpPgAdmin\Modules\Status;

use PhpPgAdmin\Core\Contracts\Module;
use PhpPgAdmin\Core\Contracts\ProvidesApiRoutes;
use PhpPgAdmin\Core\Contracts\ProvidesFrontendScripts;
use PhpPgAdmin\Core\Contracts\ProvidesSqlTemplates;
use PhpPgAdmin\Core\Contracts\ProvidesTranslations;
use PhpPgAdmin\Core\Contracts\ProvidesViteEntries;

/**
 * Status: what pgAdmin's dashboard shows about a running server (its activity and the
 * statistics its charts plot) at /api/server/status, and the server's "Status" tab after
 * phpMyAdmin's, with its Server, Processes and Monitor pages.
 */
final class StatusModule implements Module, ProvidesApiRoutes, ProvidesSqlTemplates, ProvidesTranslations, ProvidesViteEntries, ProvidesFrontendScripts
{
    public function name(): string
    {
        return 'status';
    }

    public function path(): string
    {
        return __DIR__;
    }

    public function apiRoutes(): void
    {
        require __DIR__ . '/routes/api.php';
    }

    public function sqlTemplatesPath(): string
    {
        return 'resources/sql';
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
