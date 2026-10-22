<?php

declare(strict_types=1);

namespace PhpPgAdmin\Modules\Auth;

use PhpPgAdmin\Core\Contracts\Module;
use PhpPgAdmin\Core\Contracts\ProvidesApiRoutes;
use PhpPgAdmin\Core\Contracts\ProvidesGlobalMiddlewares;
use PhpPgAdmin\Modules\Auth\Http\Middleware\AddAuthHeader;

final class AuthModule implements Module, ProvidesApiRoutes, ProvidesGlobalMiddlewares
{
    public function name(): string
    {
        return 'auth';
    }

    public function path(): string
    {
        return __DIR__;
    }

    public function apiRoutes(): void
    {
        require __DIR__ . '/routes/api.php';
    }

    public function globalMiddlewares(): array
    {
        return [AddAuthHeader::class];
    }
}
