<?php

declare(strict_types=1);

namespace PhpPgAdmin\Core\Facades;

use LogicException;
use PhpPgAdmin\Core\Contracts\Module;
use PhpPgAdmin\Core\Module\ModuleRegistry;

/**
 * Static access to the module registry, so a controller can ask what the other modules provide:
 *
 *     Modules::providing(ProvidesFrontendScripts::class);
 */
final class Modules
{
    private static ?ModuleRegistry $registry = null;

    /** The kernel calls this once; tests may call it to swap in a fresh registry. */
    public static function swap(?ModuleRegistry $registry): void
    {
        self::$registry = $registry;
    }

    public static function registry(): ModuleRegistry
    {
        return self::$registry ?? throw new LogicException(
            'No module registry has been set. Boot the application through ' . \PhpPgAdmin\App::class . '::create() first.',
        );
    }

    /** @return array<string, Module> in wiring order */
    public static function all(): array
    {
        return self::registry()->all();
    }

    /**
     * @template TContract of object
     * @param class-string<TContract> $contract
     * @return array<string, Module&TContract>
     */
    public static function providing(string $contract): array
    {
        return self::registry()->providing($contract);
    }

    public static function find(string $name): ?Module
    {
        return self::registry()->find($name);
    }

    /** A path a module declares, made absolute. */
    public static function path(Module $module, string $path): string
    {
        return self::registry()->path($module, $path);
    }
}
