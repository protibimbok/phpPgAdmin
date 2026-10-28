<?php

declare(strict_types=1);

namespace PhpPgAdmin\Modules\Replication;

use PhpPgAdmin\Core\Contracts\Module;
use PhpPgAdmin\Core\Contracts\ProvidesApiRoutes;
use PhpPgAdmin\Core\Contracts\ProvidesFrontendScripts;
use PhpPgAdmin\Core\Contracts\ProvidesNodes;
use PhpPgAdmin\Core\Contracts\ProvidesSqlTemplates;
use PhpPgAdmin\Core\Contracts\ProvidesTranslations;
use PhpPgAdmin\Core\Contracts\ProvidesViteEntries;
use PhpPgAdmin\Core\Nodes\NodeDefinition;
use PhpPgAdmin\Modules\Replication\Http\Controllers\PublicationController;
use PhpPgAdmin\Modules\Replication\Http\Controllers\SubscriptionController;

/**
 * Replication: what pgAdmin's dashboard shows of streaming replication (the standbys in
 * pg_stat_replication, the slots, the WAL receiver of a standby) at /api/server/replication,
 * pgAdmin's publication and subscription nodes inside a database, and the server's
 * "Replication" tab where phpMyAdmin has its own.
 */
final class ReplicationModule implements Module, ProvidesNodes, ProvidesApiRoutes, ProvidesSqlTemplates, ProvidesTranslations, ProvidesViteEntries, ProvidesFrontendScripts
{
    public function name(): string
    {
        return 'replication';
    }

    public function path(): string
    {
        return __DIR__;
    }

    public function nodes(): array
    {
        return [
            new NodeDefinition(
                type: 'publication',
                collection: 'publications',
                idParam: 'pbid',
                controller: PublicationController::class,
                parent: NodeDefinition::DATABASE,
                templateDir: 'publications',
                label: 'Publications',
                icon: 's_replication',
                supports: ['sql', 'msql', 'resolve'],
            ),
            new NodeDefinition(
                type: 'subscription',
                collection: 'subscriptions',
                idParam: 'subid',
                controller: SubscriptionController::class,
                parent: NodeDefinition::DATABASE,
                templateDir: 'subscriptions',
                label: 'Subscriptions',
                icon: 's_replication',
                supports: ['sql', 'msql', 'stats', 'resolve'],
            ),
        ];
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
