<?php

declare(strict_types=1);

namespace PhpPgAdmin\Core\Facades;

/**
 * Static access to the configuration, every file in config/ keyed by its name:
 *
 *     Config::get('db.host');          // config/db.php, key "host"
 *     Config::get('db.port', 5432);    // with a default
 */
final class Config
{
    /** @var array<string, mixed> */
    private static array $items = [];

    /**
     * The application sets this once at boot; tests may call it to swap in their own values.
     *
     * @param array<string, mixed> $items
     */
    public static function swap(array $items): void
    {
        self::$items = $items;
    }

    /** @return array<string, mixed> */
    public static function all(): array
    {
        return self::$items;
    }

    public static function has(string $key): bool
    {
        $missing = new \stdClass();

        return self::get($key, $missing) !== $missing;
    }

    /** Read a value by its dot-separated path, e.g. "db.host". */
    public static function get(string $key, mixed $default = null): mixed
    {
        $value = self::$items;

        foreach (explode('.', $key) as $segment) {
            if (!is_array($value) || !array_key_exists($segment, $value)) {
                return $default;
            }
            $value = $value[$segment];
        }

        return $value;
    }
}
