<?php

declare(strict_types=1);

namespace PhpPgAdmin\Core\Contracts;

use PhpPgAdmin\Core\Http\Middleware;

interface ProvidesGlobalMiddlewares
{
    /**
     * The middleware the module appends to the global middleware stack.
     *
     * @return list<class-string<Middleware>>
     */
    public function globalMiddlewares(): array;
}
