<?php

declare(strict_types=1);

namespace PhpPgAdmin\Modules\Tables;

use PhpPgAdmin\Core\Contracts\Module;
use PhpPgAdmin\Core\Contracts\ProvidesApiRoutes;
use PhpPgAdmin\Core\Contracts\ProvidesFrontendScripts;
use PhpPgAdmin\Core\Contracts\ProvidesNodes;
use PhpPgAdmin\Core\Contracts\ProvidesSqlTemplates;
use PhpPgAdmin\Core\Contracts\ProvidesTranslations;
use PhpPgAdmin\Core\Contracts\ProvidesViteEntries;
use PhpPgAdmin\Core\Nodes\NodeDefinition;
use PhpPgAdmin\Modules\Tables\Http\Controllers\CheckConstraintController;
use PhpPgAdmin\Modules\Tables\Http\Controllers\ColumnController;
use PhpPgAdmin\Modules\Tables\Http\Controllers\ExclusionConstraintController;
use PhpPgAdmin\Modules\Tables\Http\Controllers\ForeignKeyController;
use PhpPgAdmin\Modules\Tables\Http\Controllers\IndexController;
use PhpPgAdmin\Modules\Tables\Http\Controllers\PrimaryKeyController;
use PhpPgAdmin\Modules\Tables\Http\Controllers\TableController;
use PhpPgAdmin\Modules\Tables\Http\Controllers\UniqueConstraintController;

/**
 * Tables: pgAdmin's table node and what hangs under it, and the pages phpMyAdmin gives a table
 * (browse, structure, operations…). Also the schema's "Structure" page, which lists its relations.
 */
final class TablesModule implements Module, ProvidesNodes, ProvidesApiRoutes, ProvidesSqlTemplates, ProvidesTranslations, ProvidesViteEntries, ProvidesFrontendScripts
{
    public function name(): string
    {
        return 'tables';
    }

    public function path(): string
    {
        return __DIR__;
    }

    public function nodes(): array
    {
        return [
            new NodeDefinition(
                type: 'table',
                collection: 'tables',
                idParam: 'tid',
                controller: TableController::class,
                parent: 'schema',
                templateDir: 'tables',
                label: 'Tables',
                icon: 's_tbl',
                supports: ['sql', 'msql', 'stats', 'depends', 'children', 'resolve'],
            ),
            // What hangs under a table. The id of a column is its attribute number; the
            // constraints are addressed by their index (primary key, unique, exclusion) or by
            // the constraint itself (foreign key, check), as pgAdmin's templates expect.
            new NodeDefinition('column', 'columns', 'clid', ColumnController::class, parent: 'table', templateDir: 'columns', label: 'Columns', icon: 'pause', supports: ['sql', 'msql', 'stats', 'depends']),
            new NodeDefinition('index', 'indexes', 'idx', IndexController::class, parent: 'table', templateDir: 'indexes', label: 'Indexes', icon: 'b_index', supports: ['sql', 'msql', 'stats', 'depends']),
            new NodeDefinition('primary_key', 'primary-keys', 'cid', PrimaryKeyController::class, parent: 'table', templateDir: 'index_constraint', label: 'Primary key', icon: 'b_primary', supports: ['sql', 'msql', 'stats', 'depends']),
            new NodeDefinition('unique_constraint', 'unique-constraints', 'cid', UniqueConstraintController::class, parent: 'table', templateDir: 'index_constraint', label: 'Unique constraints', icon: 'b_unique', supports: ['sql', 'msql', 'stats', 'depends']),
            new NodeDefinition('foreign_key', 'foreign-keys', 'cid', ForeignKeyController::class, parent: 'table', templateDir: 'foreign_key', label: 'Foreign keys', icon: 'b_relations', supports: ['sql', 'msql', 'depends']),
            new NodeDefinition('check_constraint', 'check-constraints', 'cid', CheckConstraintController::class, parent: 'table', templateDir: 'check_constraint', label: 'Check constraints', icon: 's_okay', supports: ['sql', 'msql', 'depends']),
            new NodeDefinition('exclusion_constraint', 'exclusion-constraints', 'exid', ExclusionConstraintController::class, parent: 'table', templateDir: 'exclusion_constraint', label: 'Exclusion constraints', icon: 's_cancel', supports: ['sql', 'msql', 'stats', 'depends']),
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
