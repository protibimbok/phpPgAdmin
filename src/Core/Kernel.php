<?php

declare(strict_types=1);

namespace PhpPgAdmin\Core;

use PhpPgAdmin\Core\Contracts\ProvidesApiRoutes;
use PhpPgAdmin\Core\Contracts\ProvidesGlobalMiddlewares;
use PhpPgAdmin\Core\Contracts\ProvidesRoutes;
use PhpPgAdmin\Core\Facades\Route;
use PhpPgAdmin\Core\Http\ApiStrategy;
use PhpPgAdmin\Core\Module\ModuleRegistry;
use PhpPgAdmin\Core\Routing\Router;
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

    private bool $booted = false;

    /**
     * @param array{web?: array{prefix?: string, middleware?: list<class-string<MiddlewareInterface>>}, api?: array{prefix?: string, middleware?: list<class-string<MiddlewareInterface>>}} $routeGroups
     */
    public function __construct(
        private readonly ModuleRegistry $modules,
        ResponseFactoryInterface $responseFactory,
        private readonly array $routeGroups = [],
        bool $debug = false,
    ) {
        $this->router = new Router();
        $this->router->setStrategy(new ApiStrategy($responseFactory, $debug));

        Route::swap($this->router);
    }

    public function router(): Router
    {
        return $this->router;
    }

    public function modules(): ModuleRegistry
    {
        return $this->modules;
    }

    public function boot(): self
    {
        if ($this->booted) {
            return $this;
        }

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
    }
}
