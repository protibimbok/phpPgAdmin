<?php

declare(strict_types=1);

namespace PhpPgAdmin\Modules\Types;

use PhpPgAdmin\Core\Contracts\Module;
use PhpPgAdmin\Core\Contracts\ProvidesApiRoutes;
use PhpPgAdmin\Core\Contracts\ProvidesFrontendScripts;
use PhpPgAdmin\Core\Contracts\ProvidesNodes;
use PhpPgAdmin\Core\Contracts\ProvidesSqlTemplates;
use PhpPgAdmin\Core\Contracts\ProvidesTranslations;
use PhpPgAdmin\Core\Contracts\ProvidesViteEntries;
use PhpPgAdmin\Core\Nodes\NodeDefinition;
use PhpPgAdmin\Modules\Types\Http\Controllers\DomainController;
use PhpPgAdmin\Modules\Types\Http\Controllers\TypeController;

/** Types: pgAdmin's type and domain nodes, and the schema's Types page (list and editor). */
final class TypesModule implements Module, ProvidesNodes, ProvidesApiRoutes, ProvidesSqlTemplates, ProvidesTranslations, ProvidesViteEntries, ProvidesFrontendScripts
{
    public function name(): string
    {
        return 'types';
    }

    public function path(): string
    {
        return __DIR__;
    }

    public function nodes(): array
    {
        return [
            // phpMyAdmin has no type icon; its plugin (puzzle piece) icon stands for user-defined types.
            new NodeDefinition('type', 'types', 'tid', TypeController::class, parent: 'schema', templateDir: 'types', label: 'Types', icon: 'b_plugin', supports: ['sql', 'msql', 'depends', 'resolve']),
            new NodeDefinition('domain', 'domains', 'doid', DomainController::class, parent: 'schema', templateDir: 'domains', label: 'Domains', icon: 'b_plugin', supports: ['sql', 'msql', 'depends', 'resolve']),
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
