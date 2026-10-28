<?php

declare(strict_types=1);

namespace PhpPgAdmin\Modules\Views;

use PhpPgAdmin\Core\Contracts\Module;
use PhpPgAdmin\Core\Contracts\ProvidesApiRoutes;
use PhpPgAdmin\Core\Contracts\ProvidesFrontendScripts;
use PhpPgAdmin\Core\Contracts\ProvidesNodes;
use PhpPgAdmin\Core\Contracts\ProvidesSqlTemplates;
use PhpPgAdmin\Core\Contracts\ProvidesTranslations;
use PhpPgAdmin\Core\Contracts\ProvidesViteEntries;
use PhpPgAdmin\Core\Nodes\NodeDefinition;
use PhpPgAdmin\Modules\Tables\Http\Controllers\RuleController;
use PhpPgAdmin\Modules\Tables\Http\Controllers\TriggerController;
use PhpPgAdmin\Modules\Views\Http\Controllers\MaterializedViewController;
use PhpPgAdmin\Modules\Views\Http\Controllers\ViewController;

/**
 * Views and materialized views: pgAdmin's view and mview nodes, and the pages phpMyAdmin gives
 * a view (structure, operations, the create-view form).
 */
final class ViewsModule implements Module, ProvidesNodes, ProvidesApiRoutes, ProvidesSqlTemplates, ProvidesTranslations, ProvidesViteEntries, ProvidesFrontendScripts
{
    public function name(): string
    {
        return 'views';
    }

    public function path(): string
    {
        return __DIR__;
    }

    public function nodes(): array
    {
        return [
            new NodeDefinition(
                type: 'view',
                collection: 'views',
                idParam: 'vid',
                controller: ViewController::class,
                parent: 'schema',
                templateDir: 'views',
                label: 'Views',
                icon: 'b_views',
                supports: ['sql', 'msql', 'depends', 'children', 'resolve'],
            ),
            new NodeDefinition(
                type: 'mview',
                collection: 'mviews',
                idParam: 'vid',
                controller: MaterializedViewController::class,
                parent: 'schema',
                templateDir: 'mviews',
                label: 'Materialized views',
                icon: 'b_views',
                supports: ['sql', 'msql', 'stats', 'depends', 'children', 'resolve'],
            ),
            // A view's triggers (INSTEAD OF) and rules: the table nodes' controllers and templates,
            // registered again under the view so their routes hang from /views/{vid}.
            new NodeDefinition('view_trigger', 'triggers', 'trid', TriggerController::class, parent: 'view', templateDir: 'triggers', label: 'Triggers', icon: 'b_triggers', supports: ['sql', 'msql', 'depends']),
            new NodeDefinition('view_rule', 'rules', 'rid', RuleController::class, parent: 'view', templateDir: 'rules', label: 'Rules', icon: 'b_triggers', supports: ['sql', 'msql', 'depends']),
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
