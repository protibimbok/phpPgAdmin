<?php

declare(strict_types=1);

namespace PhpPgAdmin\Core;

use PhpPgAdmin\Core\Contracts\ProvidesApiRoutes;
use PhpPgAdmin\Core\Contracts\ProvidesGlobalMiddlewares;
use PhpPgAdmin\Core\Contracts\ProvidesMigrations;
use PhpPgAdmin\Core\Contracts\ProvidesNodes;
use PhpPgAdmin\Core\Contracts\ProvidesRoutes;
use PhpPgAdmin\Core\Contracts\ProvidesSqlTemplates;
use PhpPgAdmin\Core\Contracts\ProvidesTranslations;
use PhpPgAdmin\Core\Facades\Lang;
use PhpPgAdmin\Core\Facades\Modules;
use PhpPgAdmin\Core\Facades\Nodes;
use PhpPgAdmin\Core\Facades\Route;
use PhpPgAdmin\Core\Facades\Sql;
use PhpPgAdmin\Core\Facades\Storage;
use PhpPgAdmin\Core\I18n\Translator;
use PhpPgAdmin\Core\Http\ApiStrategy;
use PhpPgAdmin\Core\Module\ModuleRegistry;
use PhpPgAdmin\Core\Nodes\NodeRegistry;
use PhpPgAdmin\Core\Routing\Router;
use PhpPgAdmin\Core\Sql\SqlTemplates;
use PhpPgAdmin\Core\Sql\VersionedLoader;
use Psr\Http\Message\ResponseFactoryInterface;
use Psr\Http\Message\ResponseInterface;
use Psr\Http\Message\ServerRequestInterface;
use Psr\Http\Server\MiddlewareInterface;

/**
 * Wires what every registered module provides into the router, then handles requests.
 */
final class Kernel
{
    private readonly Router $router;

    private readonly Translator $translator;

    private readonly SqlTemplates $sql;

    private readonly NodeRegistry $nodes;

    private bool $booted = false;

    /**
     * @param array{web?: array{prefix?: string, middleware?: list<class-string<MiddlewareInterface>>}, api?: array{prefix?: string, middleware?: list<class-string<MiddlewareInterface>>}, nodes?: array{prefix?: string, middleware?: list<class-string<MiddlewareInterface>>}} $routeGroups
     */
    public function __construct(
        private readonly ModuleRegistry $modules,
        ResponseFactoryInterface $responseFactory,
        private readonly array $routeGroups = [],
        bool $debug = false,
        ?Translator $translator = null,
        ?SqlTemplates $sql = null,
    ) {
        $this->router = new Router();
        $this->router->setStrategy(new ApiStrategy($responseFactory, $debug));
        $this->translator = $translator ?? Translator::fromConfig([]);
        $this->sql = $sql ?? new SqlTemplates(new VersionedLoader());
        $this->nodes = new NodeRegistry();

        // The core's own templates: the macros pgAdmin's nodes share and the dependency queries.
        $this->sql->addRoot(__DIR__ . '/Sql/templates');

        Route::swap($this->router);
        Lang::swap($this->translator);
        Modules::swap($this->modules);
        Sql::swap($this->sql);
        Nodes::swap($this->nodes);
    }

    public function router(): Router
    {
        return $this->router;
    }

    public function modules(): ModuleRegistry
    {
        return $this->modules;
    }

    public function translator(): Translator
    {
        return $this->translator;
    }

    public function sql(): SqlTemplates
    {
        return $this->sql;
    }

    public function nodes(): NodeRegistry
    {
        return $this->nodes;
    }

    public function boot(): self
    {
        if ($this->booted) {
            return $this;
        }

        $this->bootTranslations();
        $this->bootSqlTemplates();
        $this->bootNodes();
        $this->bootMigrations();
        $this->bootGlobalMiddlewares();
        $this->bootRoutes();

        $this->booted = true;

        return $this;
    }

    public function handle(ServerRequestInterface $request): ResponseInterface
    {
        return $this->boot()->router->dispatch($request);
    }

    /**
     * Register each module's message directory under the module's name as namespace.
     */
    private function bootTranslations(): void
    {
        foreach ($this->modules->providing(ProvidesTranslations::class) as $module) {
            $this->translator->addNamespace($module->name(), $this->modules->path($module, $module->translationsPath()));
        }
    }

    /**
     * Add each module's SQL template directory to the roots the templates are looked up in.
     */
    private function bootSqlTemplates(): void
    {
        foreach ($this->modules->providing(ProvidesSqlTemplates::class) as $module) {
            $this->sql->addRoot($this->modules->path($module, $module->sqlTemplatesPath()));
        }
    }

    /**
     * Collect the node types the modules declare.
     */
    private function bootNodes(): void
    {
        foreach ($this->modules->providing(ProvidesNodes::class) as $module) {
            $this->nodes->register($module->nodes());
        }
    }

    /**
     * Hand each module's migration directory to the storage, which runs them when first used.
     */
    private function bootMigrations(): void
    {
        foreach ($this->modules->providing(ProvidesMigrations::class) as $module) {
            Storage::storage()->migrator()->add($module->name(), $this->modules->path($module, $module->migrationsPath()));
        }
    }

    /**
     * Append the modules' middleware to the global middleware stack.
     */
    private function bootGlobalMiddlewares(): void
    {
        foreach ($this->modules->providing(ProvidesGlobalMiddlewares::class) as $module) {
            foreach ($module->globalMiddlewares() as $middleware) {
                $this->router->lazyMiddleware($middleware);
            }
        }
    }

    /**
     * Register the modules' web and API routes within their configured groups.
     */
    private function bootRoutes(): void
    {
        foreach ($this->modules->providing(ProvidesRoutes::class) as $module) {
            Route::group($this->routeGroups['web'] ?? [], static fn () => $module->routes());
        }

        foreach ($this->modules->providing(ProvidesApiRoutes::class) as $module) {
            Route::group($this->routeGroups['api'] ?? [], static fn () => $module->apiRoutes());
        }

        // The node routes, built from the registered node types, in their own group so the
        // configuration can put them behind authentication.
        Route::group($this->routeGroups['nodes'] ?? $this->routeGroups['api'] ?? [], fn () => $this->nodes->registerRoutes());
    }
}
