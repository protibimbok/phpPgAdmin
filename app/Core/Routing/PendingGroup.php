<?php

declare(strict_types=1);

namespace PhpPgAdmin\Core\Routing;

use PhpPgAdmin\Core\Facades\Route;
use Psr\Http\Server\MiddlewareInterface;

/**
 * A group built fluently and applied when group() is called:
 *
 *     Route::prefix('auth')->controller(AuthController::class)->middleware(Authenticate::class)->group(function (): void {
 *         Route::get('/me', 'me');   // GET /auth/me, AuthController::me, behind Authenticate
 *     });
 */
final class PendingGroup
{
    private string $prefix = '';

    /** @var list<class-string<MiddlewareInterface>> */
    private array $middleware = [];

    /** @var class-string|null */
    private ?string $controller = null;

    public function prefix(string $prefix): self
    {
        $this->prefix = $prefix;

        return $this;
    }

    /** @param class-string<MiddlewareInterface>|list<class-string<MiddlewareInterface>> ...$middleware */
    public function middleware(string|array ...$middleware): self
    {
        foreach ($middleware as $m) {
            array_push($this->middleware, ...(array) $m);
        }

        return $this;
    }

    /** @param class-string $controller */
    public function controller(string $controller): self
    {
        $this->controller = $controller;

        return $this;
    }

    /** @param callable(): void $callback */
    public function group(callable $callback): void
    {
        $attributes = ['prefix' => $this->prefix, 'middleware' => $this->middleware];
        if ($this->controller !== null) {
            $attributes['controller'] = $this->controller;
        }

        Route::group($attributes, $callback);
    }
}
