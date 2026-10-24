<?php

declare(strict_types=1);

namespace PhpPgAdmin\Core\Contracts;

/**
 * A module that adds pages, menu tabs or navigation items to the single-page application.
 *
 * The scripts are Vite entries relative to the module, loaded by the HTML shell before the
 * application's own entry so that each can call registerModule() at its top level. Every
 * script must also be in the module's viteEntries(), which is what gets it built.
 */
interface ProvidesFrontendScripts
{
    /** @return list<string> */
    public function frontendScripts(): array;
}
