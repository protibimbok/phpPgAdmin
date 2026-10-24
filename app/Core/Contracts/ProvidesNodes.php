<?php

declare(strict_types=1);

namespace PhpPgAdmin\Core\Contracts;

use PhpPgAdmin\Core\Nodes\NodeDefinition;

/**
 * A module that adds object types to the browser: pgAdmin's nodes (schema, table, column…).
 * Each definition names its parent type, its controller and its templates; the node registry
 * builds the API routes from them.
 */
interface ProvidesNodes
{
    /** @return list<NodeDefinition> */
    public function nodes(): array;
}
