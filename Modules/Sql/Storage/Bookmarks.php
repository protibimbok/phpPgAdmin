<?php

declare(strict_types=1);

namespace PhpPgAdmin\Modules\Sql\Storage;

use PDO;
use PhpPgAdmin\Core\Facades\Storage;

/**
 * A role's saved queries on a server, plus the ones shared by others, after phpMyAdmin's
 * Bookmark: a shared bookmark has no owner and anyone on the server may run or delete it.
 */
final class Bookmarks
{
    public function __construct(
        private readonly PDO $db,
        public readonly string $server,
        public readonly string $username,
    ) {
    }

    public static function for(string $server, string $username): self
    {
        return new self(Storage::connection(), $server, $username);
    }

    /**
     * The bookmarks this role may use: its own and the shared ones, for one database or all.
     *
     * @return list<array<string, mixed>>
     */
    public function all(?string $database = null): array
    {
        $sql = 'SELECT id, database, label, sql, shared, created_at FROM bookmarks WHERE server = ? AND (username = ? OR shared = 1)';
        $params = [$this->server, $this->username];
        if ($database !== null) {
            $sql .= ' AND database = ?';
            $params[] = $database;
        }
        $statement = $this->db->prepare($sql . ' ORDER BY label, id');
        $statement->execute($params);

        return array_map(static fn (array $row): array => [...$row, 'id' => (int) $row['id'], 'shared' => (bool) $row['shared']], $statement->fetchAll());
    }

    /** @return array<string, mixed> the stored bookmark */
    public function create(string $database, string $label, string $sql, bool $shared, bool $replace): array
    {
        if ($replace) {
            $this->db->prepare('DELETE FROM bookmarks WHERE server = ? AND database = ? AND label = ? AND (username = ? OR shared = 1)')
                ->execute([$this->server, $database, $label, $this->username]);
        }

        $this->db->prepare('INSERT INTO bookmarks (server, username, database, label, sql, shared, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
            ->execute([$this->server, $shared ? null : $this->username, $database, $label, $sql, $shared ? 1 : 0, gmdate('Y-m-d\TH:i:s\Z')]);

        return ['id' => (int) $this->db->lastInsertId(), 'database' => $database, 'label' => $label, 'sql' => $sql, 'shared' => $shared];
    }

    /** Remove a bookmark of this role's, or a shared one; true when one was removed. */
    public function delete(int $id): bool
    {
        $statement = $this->db->prepare('DELETE FROM bookmarks WHERE id = ? AND server = ? AND (username = ? OR shared = 1)');
        $statement->execute([$id, $this->server, $this->username]);

        return $statement->rowCount() > 0;
    }
}
