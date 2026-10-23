<?php

declare(strict_types=1);

namespace PhpPgAdmin\Core\Contracts;

interface ProvidesViteEntries
{
    /**
     * The source files Vite builds for the module, relative to the module's path, e.g. "resources/js/app.js".
     *
     * @return list<string>
     */
    public function viteEntries(): array;
}
