<?php

declare(strict_types=1);

namespace PhpPgAdmin\Core\Storage;

use PDO;
use RuntimeException;

/**
 * phpPgAdmin's own database: an SQLite file like pgAdmin's pgadmin4.db, opened on first use,
 * created if missing, and brought up to date by the modules' migrations.
 */
final class Storage
{
    private ?PDO $connection = null;

    public function __construct(
        public readonly string $path,
        private readonly Migrator $migrator = new Migrator(),
    ) {
    }

    public function migrator(): Migrator
    {
        return $this->migrator;
    }

    public function connection(): PDO
    {
        if ($this->connection !== null) {
            return $this->connection;
        }

        $directory = dirname($this->path);
        if (!is_dir($directory) && !@mkdir($directory, 0775, true) && !is_dir($directory)) {
            throw new RuntimeException(sprintf('Cannot create the storage directory %s.', $directory));
        }

        $db = new PDO('sqlite:' . $this->path, null, null, [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        ]);
        $db->exec('PRAGMA journal_mode = WAL');
        $db->exec('PRAGMA busy_timeout = 5000');
        $db->exec('PRAGMA foreign_keys = ON');

        $this->migrator->migrate($db);

        return $this->connection = $db;
    }
}
