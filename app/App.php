<?php

declare(strict_types=1);

namespace PhpPgAdmin;

use Nyholm\Psr7\Factory\Psr17Factory;
use PhpPgAdmin\Core\Facades\Config;
use PhpPgAdmin\Core\Facades\Storage;
use PhpPgAdmin\Core\I18n\Translator;
use PhpPgAdmin\Core\Kernel;
use PhpPgAdmin\Core\Module\ModuleRegistry;
use PhpPgAdmin\Core\Sql\SqlTemplates;
use PhpPgAdmin\Core\Sql\VersionedLoader;
use PhpPgAdmin\Core\Storage\Storage as StorageManager;

final class App
{
    public const string VERSION = '0.1.1';

    public static function basePath(string $append = ''): string
    {
        $base = dirname(__DIR__);

        return $append === '' ? $base : $base . '/' . ltrim($append, '/');
    }

    public static function create(bool $debug = false): Kernel
    {
        $config = self::loadConfig();
        Config::swap($config);
        Storage::swap(new StorageManager((string) Config::get('storage.path', self::basePath('storage/phppgadmin.sqlite'))));

        /** @var list<class-string<Core\Contracts\Module>> $modules */
        $modules = require self::basePath('bootstrap/modules.php');

        /** @var array{routes?: array<string, array<string, mixed>>} $moduleConfig */
        $moduleConfig = $config['modules'] ?? [];

        /** @var array{default?: string, fallback?: string, locales?: array<string, array{name?: string, native?: string, dir?: string}>} $i18n */
        $i18n = $config['i18n'] ?? [];

        $registry = (new ModuleRegistry())->register($modules);

        // Compiled templates are kept beside the storage database, so they live outside the project when it does.
        $cache = dirname((string) Config::get('storage.path', self::basePath('storage/phppgadmin.sqlite'))) . '/cache/twig';
        $sql = new SqlTemplates(new VersionedLoader(), $cache);

        return (new Kernel($registry, new Psr17Factory(), $moduleConfig['routes'] ?? [], $debug, Translator::fromConfig($i18n), $sql))->boot();
    }

    /**
     * Every config/<name>.php, keyed by name, so config/db.php is read as Config::get('db.…').
     *
     * @return array<string, mixed>
     */
    private static function loadConfig(): array
    {
        $config = [];

        foreach (glob(self::basePath('config/*.php')) ?: [] as $file) {
            $values = require $file;
            if (is_array($values)) {
                $config[basename($file, '.php')] = $values;
            }
        }

        return $config;
    }
}
