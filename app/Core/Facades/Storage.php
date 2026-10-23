<?php

declare(strict_types=1);

namespace PhpPgAdmin\Core\Facades;

use LogicException;
use PDO;
use PhpPgAdmin\Core\Storage\Storage as StorageManager;

/**
 * Static access to the application storage (config/storage.php):
 *
 *     Storage::connection()->prepare('SELECT …');
 */
final class Storage
{
    private static ?StorageManager $storage = null;

    /** The application sets this once at boot; tests may call it to swap in a file of their own. */
    public static function swap(?StorageManager $storage): void
    {
        self::$storage = $storage;
    }

    public static function storage(): StorageManager
    {
        return self::$storage ?? throw new LogicException(
            'No storage has been set. Boot the application through ' . \PhpPgAdmin\App::class . '::create() first.',
        );
    }

    public static function connection(): PDO
    {
        return self::storage()->connection();
    }
}
