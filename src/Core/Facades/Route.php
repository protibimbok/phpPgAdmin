<?php

declare(strict_types=1);

namespace PhpPgAdmin\Core\Facades;

use League\Route\Route as RouteDefinition;
use League\Route\Router;
use LogicException;
use PhpPgAdmin\Core\Routing\PendingGroup;
use Psr\Http\Server\MiddlewareInterface;
use Psr\Http\Server\RequestHandlerInterface;

/**
 * Static access to the application's router, so route files read like Laravel's:
 *
 *     Route::get('/posts', [PostController::class, 'index'])->setName('posts.index');
 *
 * Groups nest and are applied eagerly: prefixes concatenate, middleware accumulates
 * and the innermost controller wins. Each route is still registered on league/route's
 * Router, which does the matching.
 */
final class Route
{
    private static ?Router $router = null;

    /** @var list<array{prefix: string, middleware: list<class-string<MiddlewareInterface>>, controller: class-string|null}> */
    private static array $groupStack = [];

    /** The kernel calls this once; tests may call it to swap in a fresh router. */
    public static function swap(?Router $router): void
    {
        self::$router = $router;
        self::$groupStack = [];
    }

    public static function router(): Router
    {
        return self::$router ?? throw new LogicException(
            'No router has been set. Boot the application through ' . \PhpPgAdmin\App::class . '::create() first.',
        );
    }

    // ---- grouping ---------------------------------------------------------------

    /**
     * Routes registered inside $callback share the given attributes.
     *
     * @param string|array{prefix?: string, middleware?: list<class-string<MiddlewareInterface>>, controller?: class-string} $attributes  A string is a prefix
     * @param callable(): void $callback
     */
    public static function group(string|array $attributes, callable $callback): void
    {
        if (is_string($attributes)) {
            $attributes = ['prefix' => $attributes];
        }

        $parent = self::$groupStack === [] ? null : end(self::$groupStack);

        self::$groupStack[] = [
            'prefix' => trim($attributes['prefix'] ?? '', '/'),
            'middleware' => array_values($attributes['middleware'] ?? []),
            'controller' => $attributes['controller'] ?? $parent['controller'] ?? null,
        ];

        try {
            $callback();
        } finally {
            array_pop(self::$groupStack);
        }
    }

    public static function prefix(string $prefix): PendingGroup
    {
        return (new PendingGroup())->prefix($prefix);
    }

    /** @param class-string<MiddlewareInterface>|list<class-string<MiddlewareInterface>> ...$middleware */
    public static function middleware(string|array ...$middleware): PendingGroup
    {
        return (new PendingGroup())->middleware(...$middleware);
    }

    /**
     * Routes in the group belong to one controller, so an action may be given as a method name:
     *
     *     Route::controller(AuthController::class)->group(fn () => Route::post('/login', 'login'));
     *
     * @param class-string $controller
     */
    public static function controller(string $controller): PendingGroup
    {
        return (new PendingGroup())->controller($controller);
    }

    // ---- registration -----------------------------------------------------------

    /**
     * @param string|list<string> $methods
     * @param callable|array{0: class-string|object, 1: string}|class-string|RequestHandlerInterface $handler
     */
    public static function map(string|array $methods, string $path, callable|array|string|RequestHandlerInterface $handler): RouteDefinition
    {
        $prefix = implode('/', array_filter(array_column(self::$groupStack, 'prefix'), static fn (string $p): bool => $p !== ''));
        $path = trim($path, '/');
        $full = '/' . trim($prefix . '/' . $path, '/');

        $handler = self::resolveHandler($handler);
        $route = self::router()->map($methods, $full, $handler);

        $middleware = array_merge([], ...array_column(self::$groupStack, 'middleware'));
        if ($middleware !== []) {
            $route->lazyMiddlewares($middleware);
        }

        return $route;
    }

    /** @param callable|array{0: class-string|object, 1: string}|class-string|RequestHandlerInterface $handler */
    public static function get(string $path, callable|array|string|RequestHandlerInterface $handler): RouteDefinition
    {
        return self::map('GET', $path, $handler);
    }

    /** @param callable|array{0: class-string|object, 1: string}|class-string|RequestHandlerInterface $handler */
    public static function post(string $path, callable|array|string|RequestHandlerInterface $handler): RouteDefinition
    {
        return self::map('POST', $path, $handler);
    }

    /** @param callable|array{0: class-string|object, 1: string}|class-string|RequestHandlerInterface $handler */
    public static function put(string $path, callable|array|string|RequestHandlerInterface $handler): RouteDefinition
    {
        return self::map('PUT', $path, $handler);
    }

    /** @param callable|array{0: class-string|object, 1: string}|class-string|RequestHandlerInterface $handler */
    public static function patch(string $path, callable|array|string|RequestHandlerInterface $handler): RouteDefinition
    {
        return self::map('PATCH', $path, $handler);
    }

    /** @param callable|array{0: class-string|object, 1: string}|class-string|RequestHandlerInterface $handler */
    public static function delete(string $path, callable|array|string|RequestHandlerInterface $handler): RouteDefinition
    {
        return self::map('DELETE', $path, $handler);
    }

    /** @param callable|array{0: class-string|object, 1: string}|class-string|RequestHandlerInterface $handler */
    public static function options(string $path, callable|array|string|RequestHandlerInterface $handler): RouteDefinition
    {
        return self::map('OPTIONS', $path, $handler);
    }

    /** @param callable|array{0: class-string|object, 1: string}|class-string|RequestHandlerInterface $handler */
    public static function any(string $path, callable|array|string|RequestHandlerInterface $handler): RouteDefinition
    {
        return self::map(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'], $path, $handler);
    }

    /**
     * Inside a controller group, a bare method name is an action on that controller.
     *
     * @param callable|array{0: class-string|object, 1: string}|class-string|RequestHandlerInterface $handler
     * @return callable|array{0: class-string|object, 1: string}|class-string|RequestHandlerInterface
     */
    private static function resolveHandler(callable|array|string|RequestHandlerInterface $handler): callable|array|string|RequestHandlerInterface
    {
        $controller = self::$groupStack === [] ? null : end(self::$groupStack)['controller'];

        if ($controller === null || !is_string($handler)) {
            return $handler;
        }

        if (str_contains($handler, '::') || class_exists($handler) || function_exists($handler)) {
            return $handler;
        }

        if (!method_exists($controller, $handler)) {
            throw new LogicException(sprintf('Route action [%s] does not exist on controller [%s].', $handler, $controller));
        }

        return [$controller, $handler];
    }

    /** @return list<RouteDefinition> */
    public static function routes(): array
    {
        return self::router()->getRoutes();
    }
}
