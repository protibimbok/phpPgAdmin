<?php

declare(strict_types=1);

namespace PhpPgAdmin;

use Nyholm\Psr7\Factory\Psr17Factory;
use PhpPgAdmin\Core\Kernel;
use PhpPgAdmin\Core\Module\ModuleRegistry;

final class App
{
    public static function basePath(string $append = ''): string
    {
        $base = dirname(__DIR__);

        return $append === '' ? $base : $base . '/' . ltrim($append, '/');
    }

    public static function create(bool $debug = false): Kernel
    {
        /** @var list<class-string<Core\Contracts\Module>> $modules */
        $modules = require self::basePath('bootstrap/modules.php');

        /** @var array{routes?: array<string, array<string, mixed>>} $config */
        $config = require self::basePath('config/modules.php');

        $registry = (new ModuleRegistry())->register($modules);

        return (new Kernel($registry, new Psr17Factory(), $config['routes'] ?? [], $debug))->boot();
    }
}
