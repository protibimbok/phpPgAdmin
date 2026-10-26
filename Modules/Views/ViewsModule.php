<?php

declare(strict_types=1);

namespace PhpPgAdmin\Modules\Views;

use PhpPgAdmin\Core\Contracts\Module;
use PhpPgAdmin\Core\Contracts\ProvidesNodes;
use PhpPgAdmin\Core\Contracts\ProvidesSqlTemplates;
use PhpPgAdmin\Core\Nodes\NodeDefinition;
use PhpPgAdmin\Modules\Views\Http\Controllers\MaterializedViewController;
use PhpPgAdmin\Modules\Views\Http\Controllers\ViewController;

/** Views and materialized views: pgAdmin's view and mview nodes. */
final class ViewsModule implements Module, ProvidesNodes, ProvidesSqlTemplates
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
        ];
    }

    public function sqlTemplatesPath(): string
    {
        return 'resources/sql';
    }
}
