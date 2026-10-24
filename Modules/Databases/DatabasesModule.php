<?php

declare(strict_types=1);

namespace PhpPgAdmin\Modules\Databases;

use PhpPgAdmin\Core\Contracts\Module;
use PhpPgAdmin\Core\Contracts\ProvidesFrontendScripts;
use PhpPgAdmin\Core\Contracts\ProvidesNodes;
use PhpPgAdmin\Core\Contracts\ProvidesSqlTemplates;
use PhpPgAdmin\Core\Contracts\ProvidesTranslations;
use PhpPgAdmin\Core\Contracts\ProvidesViteEntries;
use PhpPgAdmin\Core\Nodes\NodeDefinition;
use PhpPgAdmin\Modules\Databases\Http\Controllers\DatabaseController;

/**
 * The databases of the server a session is signed in to: pgAdmin's database node, served at
 * /api/server/databases, and the page that lists them like phpMyAdmin's "Databases" tab.
 */
final class DatabasesModule implements Module, ProvidesNodes, ProvidesSqlTemplates, ProvidesTranslations, ProvidesViteEntries, ProvidesFrontendScripts
{
    public function name(): string
    {
        return 'databases';
    }

    public function path(): string
    {
        return __DIR__;
    }

    public function nodes(): array
    {
        return [
            new NodeDefinition(
                type: 'database',
                collection: 'databases',
                idParam: 'did',
                controller: DatabaseController::class,
                parent: NodeDefinition::SERVER,
                templateDir: 'databases',
                label: 'Databases',
                icon: 's_db',
                supports: ['sql', 'stats', 'depends', 'children', 'resolve'],
            ),
        ];
    }

    /** pgAdmin's databases/sql templates, ported to Twig. */
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

    /** Registers the "Databases" tab, its page and the databases in the navigation tree. */
    public function frontendScripts(): array
    {
        return ['resources/js/app.tsx'];
    }
}
