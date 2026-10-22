<?php

declare(strict_types=1);

namespace PhpPgAdmin\Core\Routing;

use League\Route\Router as LeagueRouter;
use Override;

/**
 * league/route's router with one fix: the OPTIONS routes it generates for a
 * strategy that implements OptionsHandlerInterface are never given a strategy,
 * so dispatching one fails against the freeze guard. Give them the router's.
 */
final class Router extends LeagueRouter
{
    /** @param array<string, array<string>> $options */
    #[Override]
    protected function buildOptionsRoutes(array $options, int $index = 0): void
    {
        parent::buildOptionsRoutes($options, $index);

        $strategy = $this->getStrategy();
        if ($strategy === null) {
            return;
        }

        foreach ($this->routeMap as $route) {
            if ($route->getStrategy() === null) {
                $route->setStrategy($strategy);
            }
        }
    }
}
