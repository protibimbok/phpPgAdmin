<?php

declare(strict_types=1);

namespace PhpPgAdmin\Core\Contracts;

interface ProvidesRoutes
{
    /**
     * Register the module's web routes. They are wrapped in the configured "web" group.
     */
    public function routes(): void;
}
