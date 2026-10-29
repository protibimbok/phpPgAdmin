<?php

declare(strict_types=1);

namespace PhpPgAdmin\Modules\Maintenance;

use PhpPgAdmin\Core\Contracts\Module;
use PhpPgAdmin\Core\Contracts\ProvidesApiRoutes;
use PhpPgAdmin\Core\Contracts\ProvidesTranslations;

/**
 * Maintenance: pgAdmin's maintenance tool (VACUUM, ANALYZE, REINDEX, CLUSTER with their
 * options) on a database or a schema, run by psql as a background process whose output, the
 * VERBOSE messages among it, the Operations page follows. Its card is drawn by the Databases
 * and Schemas Operations pages.
 */
final class MaintenanceModule implements Module, ProvidesApiRoutes, ProvidesTranslations
{
    public function name(): string
    {
        return 'maintenance';
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
