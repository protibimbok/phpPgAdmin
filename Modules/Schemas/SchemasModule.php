<?php

declare(strict_types=1);

namespace PhpPgAdmin\Modules\Schemas;

use PhpPgAdmin\Core\Contracts\Module;
use PhpPgAdmin\Core\Contracts\ProvidesApiRoutes;
use PhpPgAdmin\Core\Contracts\ProvidesFrontendScripts;
use PhpPgAdmin\Core\Contracts\ProvidesNodes;
use PhpPgAdmin\Core\Contracts\ProvidesSqlTemplates;
use PhpPgAdmin\Core\Contracts\ProvidesTranslations;
use PhpPgAdmin\Core\Contracts\ProvidesViteEntries;
use PhpPgAdmin\Core\Nodes\NodeDefinition;
use PhpPgAdmin\Modules\Schemas\Http\Controllers\SchemaController;

/**
 * The schemas of a database: pgAdmin's schema node at /api/databases/{db}/schemas, and the
 * database's "Structure" page, which lists them the way phpMyAdmin's lists a database's tables.
 */
final class SchemasModule implements Module, ProvidesApiRoutes, ProvidesNodes, ProvidesSqlTemplates, ProvidesTranslations, ProvidesViteEntries, ProvidesFrontendScripts
{
    public function name(): string
    {
        return 'schemas';
    }

    public function path(): string
    {
        return __DIR__;
    }

    public function nodes(): array
    {
        return [
            new NodeDefinition(
                type: 'schema',
                collection: 'schemas',
                idParam: 'scid',
                controller: SchemaController::class,
                parent: NodeDefinition::DATABASE,
                templateDir: 'schemas',
                label: 'Schemas',
                icon: 'b_props',
                supports: ['sql', 'msql', 'depends', 'children', 'resolve'],
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
