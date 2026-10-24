<?php

declare(strict_types=1);

namespace PhpPgAdmin\Core\Module;

use InvalidArgumentException;
use LogicException;
use PhpPgAdmin\Core\Contracts\Module;
use PhpPgAdmin\Core\Contracts\Ordered;
use PhpPgAdmin\Core\Contracts\ProvidesApiRoutes;
use PhpPgAdmin\Core\Contracts\ProvidesFrontendScripts;
use PhpPgAdmin\Core\Contracts\ProvidesGlobalMiddlewares;
use PhpPgAdmin\Core\Contracts\ProvidesMigrations;
use PhpPgAdmin\Core\Contracts\ProvidesRoutes;
use PhpPgAdmin\Core\Contracts\ProvidesTranslations;
use PhpPgAdmin\Core\Contracts\ProvidesViteEntries;

final class ModuleRegistry
{
    /**
     * The contracts a module may implement to provide a capability.
     *
     * @var array<string, class-string>
     */
    public const array CAPABILITIES = [
        'routes' => ProvidesRoutes::class,
        'api' => ProvidesApiRoutes::class,
        'global-middlewares' => ProvidesGlobalMiddlewares::class,
        'vite' => ProvidesViteEntries::class,
        'frontend-scripts' => ProvidesFrontendScripts::class,
        'translations' => ProvidesTranslations::class,
        'migrations' => ProvidesMigrations::class,
    ];

    /** @var array<string, Module> keyed by name, in registration order */
    private array $modules = [];

    /** @var array<string, Module>|null in wiring order */
    private ?array $sorted = null;

    /**
     * @param iterable<class-string<Module>|Module>|class-string<Module>|Module $modules
     */
    public function register(iterable|string|Module $modules): self
    {
        foreach (is_iterable($modules) ? $modules : [$modules] as $module) {
            $module = is_string($module) ? new $module() : $module;

            if (!$module instanceof Module) {
                throw new InvalidArgumentException(sprintf(
                    'Module [%s] must implement [%s].', get_debug_type($module), Module::class,
                ));
            }

            if (isset($this->modules[$module->name()])) {
                throw new LogicException(sprintf(
                    'Duplicate module [%s] registered by [%s] and [%s].',
                    $module->name(), $this->modules[$module->name()]::class, $module::class,
                ));
            }

            $this->modules[$module->name()] = $module;
        }

        $this->sorted = null;

        return $this;
    }

    /**
     * Every module in the order it should be wired.
     *
     * @return array<string, Module>
     */
    public function all(): array
    {
        return $this->sorted ??= $this->sort($this->modules);
    }

    /**
     * The modules that implement the given capability contract.
     *
     * @template TContract of object
     * @param class-string<TContract> $contract
     * @return array<string, Module&TContract>
     */
    public function providing(string $contract): array
    {
        return array_filter($this->all(), static fn (Module $module): bool => $module instanceof $contract);
    }

    public function find(string $name): ?Module
    {
        return $this->modules[$name] ?? null;
    }

    public function has(string $name): bool
    {
        return isset($this->modules[$name]);
    }

    /**
     * Every known capability and whether the module provides it.
     *
     * @return array<string, bool>
     */
    public function capabilities(Module $module): array
    {
        return array_map(static fn (string $contract): bool => $module instanceof $contract, self::CAPABILITIES);
    }

    /**
     * The absolute path of what a module declares: "routes" is relative to the module,
     * an absolute path is taken as it is.
     */
    public function path(Module $module, string $path): string
    {
        if (preg_match('#^([A-Za-z]:)?[/\\\\]#', $path)) {
            return $path;
        }

        return rtrim($module->path(), '/\\') . '/' . $path;
    }

    /**
     * Sort by order, keeping registration order for ties. A negative order sorts last.
     *
     * @param array<string, Module> $modules
     * @return array<string, Module>
     */
    private function sort(array $modules): array
    {
        $position = array_flip(array_keys($modules));

        $key = static function (Module $module) use ($position): array {
            $order = $module instanceof Ordered ? $module->order() : 0;

            return [$order < 0, max($order, 0), $position[$module->name()]];
        };

        uasort($modules, static fn (Module $a, Module $b): int => $key($a) <=> $key($b));

        return $modules;
    }
}
