<?php

declare(strict_types=1);

namespace PhpPgAdmin\Modules\Roles;

use PhpPgAdmin\Core\Contracts\Module;
use PhpPgAdmin\Core\Contracts\ProvidesApiRoutes;
use PhpPgAdmin\Core\Contracts\ProvidesFrontendScripts;
use PhpPgAdmin\Core\Contracts\ProvidesNodes;
use PhpPgAdmin\Core\Contracts\ProvidesSqlTemplates;
use PhpPgAdmin\Core\Contracts\ProvidesTranslations;
use PhpPgAdmin\Core\Contracts\ProvidesViteEntries;
use PhpPgAdmin\Core\Nodes\NodeDefinition;
use PhpPgAdmin\Modules\Roles\Http\Controllers\RoleController;
use PhpPgAdmin\Modules\Roles\Http\Controllers\TablespaceController;

/**
 * Roles: pgAdmin's role node at /api/server/roles and its tablespace node at
 * /api/server/tablespaces; the server's "Roles" tab after phpMyAdmin's "User accounts", the
 * "Tablespaces" tab and the Privileges tabs.
 */
final class RolesModule implements Module, ProvidesNodes, ProvidesApiRoutes, ProvidesSqlTemplates, ProvidesTranslations, ProvidesViteEntries, ProvidesFrontendScripts
{
    public function name(): string
    {
        return 'roles';
    }

    public function path(): string
    {
        return __DIR__;
    }

    public function nodes(): array
    {
        return [
            new NodeDefinition(
                type: 'role',
                collection: 'roles',
                idParam: 'rid',
                controller: RoleController::class,
                parent: NodeDefinition::SERVER,
                templateDir: 'roles',
                label: 'Login/Group Roles',
                icon: 'user',
                supports: ['sql', 'msql', 'resolve'],
            ),
            new NodeDefinition(
                type: 'tablespace',
                collection: 'tablespaces',
                idParam: 'tsid',
                controller: TablespaceController::class,
                parent: NodeDefinition::SERVER,
                templateDir: 'tablespaces',
                label: 'Tablespaces',
                icon: 'b_tblops',
                supports: ['sql', 'msql', 'stats', 'depends', 'resolve'],
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
