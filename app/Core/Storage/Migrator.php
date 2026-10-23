<?php

declare(strict_types=1);

namespace PhpPgAdmin\Core\Storage;

use PDO;
use RuntimeException;

/**
 * Runs the migration files the modules provide, once each, recording them in a "migrations"
 * table under "<module>/<file>", so every module owns its part of the schema.
 */
final class Migrator
{
    /** @var array<string, string> module name => absolute directory */
    private array $directories = [];

    public function add(string $module, string $directory): void
    {
        $this->directories[$module] = $directory;
    }

    /** @return list<string> the names of the migrations that ran */
    public function migrate(PDO $db): array
    {
        $db->exec('CREATE TABLE IF NOT EXISTS migrations (name TEXT PRIMARY KEY, batch INTEGER NOT NULL, ran_at TEXT NOT NULL)');

        $ran = array_flip($db->query('SELECT name FROM migrations')->fetchAll(PDO::FETCH_COLUMN));
        $pending = array_filter($this->all(), static fn (string $name): bool => !isset($ran[$name]), ARRAY_FILTER_USE_KEY);

        if ($pending === []) {
            return [];
        }

        $batch = (int) $db->query('SELECT COALESCE(MAX(batch), 0) + 1 FROM migrations')->fetchColumn();
        $insert = $db->prepare('INSERT INTO migrations (name, batch, ran_at) VALUES (?, ?, ?)');
        $done = [];

        foreach ($pending as $name => $file) {
            $migration = require $file;
            if (!$migration instanceof Migration) {
                throw new RuntimeException(sprintf('Migration %s must return a %s.', $file, Migration::class));
            }

            $db->beginTransaction();
            try {
                $migration->up($db);
                $insert->execute([$name, $batch, gmdate('Y-m-d\TH:i:s\Z')]);
                $db->commit();
            } catch (\Throwable $e) {
                if ($db->inTransaction()) {
                    $db->rollBack();
                }
                throw new RuntimeException(sprintf('Migration %s failed: %s', $name, $e->getMessage()), 0, $e);
            }

            $done[] = $name;
        }

        return $done;
    }

    /**
     * Every migration file, keyed by "<module>/<file>" and sorted by file name across modules,
     * so a module's later migration may build on another module's earlier one.
     *
     * @return array<string, string>
     */
    private function all(): array
    {
        $files = [];

        foreach ($this->directories as $module => $directory) {
            foreach (glob(rtrim($directory, '/\\') . '/*.php') ?: [] as $file) {
                $files[$module . '/' . basename($file, '.php')] = $file;
            }
        }

        uksort($files, static fn (string $a, string $b): int => strcmp(substr($a, strpos($a, '/') + 1), substr($b, strpos($b, '/') + 1)) ?: strcmp($a, $b));

        return $files;
    }
}
