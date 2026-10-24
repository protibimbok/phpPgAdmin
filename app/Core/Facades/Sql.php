<?php

declare(strict_types=1);

namespace PhpPgAdmin\Core\Facades;

use LogicException;
use PhpPgAdmin\Core\Sql\SqlTemplates;

/**
 * Static access to the SQL templates:
 *
 *     Sql::render('tables', 'properties.sql', ['scid' => $scid, 'conn' => $conn], $conn->version());
 */
final class Sql
{
    private static ?SqlTemplates $templates = null;

    /** The kernel sets this once at boot; tests may call it to swap in roots of their own. */
    public static function swap(?SqlTemplates $templates): void
    {
        self::$templates = $templates;
    }

    public static function templates(): SqlTemplates
    {
        return self::$templates ?? throw new LogicException('No SQL templates have been set. Boot the application through ' . \PhpPgAdmin\App::class . '::create() first.');
    }

    /** @param array<string, mixed> $vars */
    public static function render(string $node, string $file, array $vars = [], int $serverVersion = 0): string
    {
        return self::templates()->render($node, $file, $vars, $serverVersion);
    }

    public static function has(string $node, string $file, int $serverVersion = 0): bool
    {
        return self::templates()->has($node, $file, $serverVersion);
    }
}
