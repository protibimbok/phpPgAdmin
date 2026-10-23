<?php

declare(strict_types=1);

namespace PhpPgAdmin\Modules\Frontend;

use PhpPgAdmin\Core\Contracts\Module;
use PhpPgAdmin\Core\Contracts\Ordered;
use PhpPgAdmin\Core\Contracts\ProvidesRoutes;

/**
 * Serves the HTML shell the React application in src/ boots from. Every path that
 * is not an API route gets the shell, so the client decides what to show.
 */
final class FrontendModule implements Module, ProvidesRoutes, Ordered
{
    public function name(): string
    {
        return 'frontend';
    }

    public function path(): string
    {
        return __DIR__;
    }

    /** Last, so its catch-all never shadows another module's web routes. */
    public function order(): int
    {
        return -1;
    }

    public function routes(): void
    {
        require __DIR__ . '/routes/web.php';
    }
}
