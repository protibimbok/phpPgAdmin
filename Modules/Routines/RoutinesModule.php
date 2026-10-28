<?php

declare(strict_types=1);

namespace PhpPgAdmin\Modules\Routines;

use PhpPgAdmin\Core\Contracts\Module;
use PhpPgAdmin\Core\Contracts\ProvidesApiRoutes;
use PhpPgAdmin\Core\Contracts\ProvidesFrontendScripts;
use PhpPgAdmin\Core\Contracts\ProvidesNodes;
use PhpPgAdmin\Core\Contracts\ProvidesSqlTemplates;
use PhpPgAdmin\Core\Contracts\ProvidesTranslations;
use PhpPgAdmin\Core\Contracts\ProvidesViteEntries;
use PhpPgAdmin\Core\Nodes\NodeDefinition;
use PhpPgAdmin\Modules\Routines\Http\Controllers\AggregateController;
use PhpPgAdmin\Modules\Routines\Http\Controllers\FunctionController;
use PhpPgAdmin\Modules\Routines\Http\Controllers\OperatorController;
use PhpPgAdmin\Modules\Routines\Http\Controllers\ProcedureController;
use PhpPgAdmin\Modules\Routines\Http\Controllers\TriggerFunctionController;

/**
 * Routines: pgAdmin's function, procedure and trigger function nodes, and phpMyAdmin's
 * Routines page (list, editor, execute) at the schema level.
 */
final class RoutinesModule implements Module, ProvidesNodes, ProvidesApiRoutes, ProvidesSqlTemplates, ProvidesTranslations, ProvidesViteEntries, ProvidesFrontendScripts
{
    public function name(): string
    {
        return 'routines';
    }

    public function path(): string
    {
        return __DIR__;
    }

    public function nodes(): array
    {
        $supports = ['sql', 'msql', 'stats', 'depends'];

        return [
            new NodeDefinition('function', 'functions', 'fnid', FunctionController::class, parent: 'schema', templateDir: 'functions', label: 'Functions', icon: 'b_routines', supports: $supports),
            new NodeDefinition('procedure', 'procedures', 'fnid', ProcedureController::class, parent: 'schema', templateDir: 'procedures', label: 'Procedures', icon: 'b_routines', supports: $supports),
            new NodeDefinition('trigger_function', 'trigger-functions', 'fnid', TriggerFunctionController::class, parent: 'schema', templateDir: 'trigger_functions', label: 'Trigger functions', icon: 'b_routines', supports: $supports),
            // Read-only, as pgAdmin's are: the DDL and DROP, no editor.
            new NodeDefinition('aggregate', 'aggregates', 'agid', AggregateController::class, parent: 'schema', templateDir: 'aggregates', label: 'Aggregates', icon: 'b_routines', supports: ['sql', 'depends']),
            new NodeDefinition('operator', 'operators', 'opid', OperatorController::class, parent: 'schema', templateDir: 'operators', label: 'Operators', icon: 'b_routines', supports: ['sql', 'depends']),
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
