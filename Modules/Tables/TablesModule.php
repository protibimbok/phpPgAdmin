<?php

declare(strict_types=1);

namespace PhpPgAdmin\Modules\Tables;

use PhpPgAdmin\Core\Contracts\Module;
use PhpPgAdmin\Core\Contracts\ProvidesApiRoutes;
use PhpPgAdmin\Core\Contracts\ProvidesNodes;
use PhpPgAdmin\Core\Contracts\ProvidesSqlTemplates;
use PhpPgAdmin\Core\Nodes\NodeDefinition;
use PhpPgAdmin\Modules\Tables\Http\Controllers\TableController;

/**
 * Tables: pgAdmin's table node and what hangs under it, and the pages phpMyAdmin gives a table
 * (browse, structure, operations…).
 */
final class TablesModule implements Module, ProvidesNodes, ProvidesApiRoutes, ProvidesSqlTemplates
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
}
