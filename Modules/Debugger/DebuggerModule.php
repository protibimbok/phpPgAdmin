<?php

declare(strict_types=1);

namespace PhpPgAdmin\Modules\Debugger;

use PhpPgAdmin\Core\Contracts\Module;
use PhpPgAdmin\Core\Contracts\ProvidesApiRoutes;
use PhpPgAdmin\Core\Contracts\ProvidesFrontendScripts;
use PhpPgAdmin\Core\Contracts\ProvidesTranslations;
use PhpPgAdmin\Core\Contracts\ProvidesViteEntries;

/**
 * Debugger: pgAdmin's PL/pgSQL debugger, direct debugging of a function or procedure called
 * with the arguments given, stepped through statement by statement with breakpoints, the
 * variables and the stack. It takes EDB's pldebugger (the pldbgapi extension and
 * plugin_debugger preloaded); without it, routines offer no Debug.
 */
final class DebuggerModule implements Module, ProvidesApiRoutes, ProvidesTranslations, ProvidesViteEntries, ProvidesFrontendScripts
{
    public function name(): string
    {
        return 'debugger';
    }

    public function path(): string
    {
        return __DIR__;
    }

    public function apiRoutes(): void
    {
        require __DIR__ . '/routes/api.php';
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
