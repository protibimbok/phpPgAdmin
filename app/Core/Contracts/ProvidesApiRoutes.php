<?php

declare(strict_types=1);

namespace PhpPgAdmin\Core\Contracts;

interface ProvidesApiRoutes
{
    /**
     * Register the module's API routes. They are wrapped in the configured "api" group.
     */
    public function apiRoutes(): void;
}
