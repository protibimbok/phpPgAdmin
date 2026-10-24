<?php

declare(strict_types=1);

namespace PhpPgAdmin\Core\Facades;

use LogicException;
use PhpPgAdmin\Core\Nodes\NodeDefinition;
use PhpPgAdmin\Core\Nodes\NodeRegistry;

/** Static access to the node registry: Nodes::get('table'), Nodes::childrenOf('schema', $version). */
final class Nodes
{
    private static ?NodeRegistry $registry = null;

    public static function swap(?NodeRegistry $registry): void
    {
        self::$registry = $registry;
    }

    public static function registry(): NodeRegistry
    {
        return self::$registry ?? throw new LogicException('No node registry has been set. Boot the application through ' . \PhpPgAdmin\App::class . '::create() first.');
    }

    public static function get(string $type): NodeDefinition
    {
        return self::registry()->get($type);
    }

    public static function find(string $type): ?NodeDefinition
    {
        return self::registry()->find($type);
    }

    /** @return list<NodeDefinition> */
    public static function childrenOf(?string $type, ?int $version = null): array
    {
        return self::registry()->childrenOf($type, $version);
    }
}
