<?php

declare(strict_types=1);

namespace PhpPgAdmin\Modules\Auth;

use PhpPgAdmin\Core\Contracts\Module;
use PhpPgAdmin\Core\Contracts\ProvidesApiRoutes;
use PhpPgAdmin\Core\Contracts\ProvidesMigrations;
use PhpPgAdmin\Core\Contracts\ProvidesTranslations;

final class AuthModule implements Module, ProvidesApiRoutes, ProvidesTranslations, ProvidesMigrations
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

    public function translationsPath(): string
    {
        return 'resources/lang';
    }

    public function migrationsPath(): string
    {
        return 'database/migrations';
    }
}
