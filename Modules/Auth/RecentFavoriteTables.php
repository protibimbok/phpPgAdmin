<?php

declare(strict_types=1);

namespace PhpPgAdmin\Modules\Auth;

use PDO;
use PhpPgAdmin\Core\Facades\Storage;

/**
 * The recently used or the favorite tables of a role on a server, after phpMyAdmin's
 * RecentFavoriteTable: newest first, at most as many as NumRecentTables / NumFavoriteTables.
 *
 * @phpstan-type Entry array{database: string, schema: string, table: string, kind: string}
 */
final class RecentFavoriteTables
{
    public const string RECENT = 'recent';
    public const string FAVORITE = 'favorite';

    /** The preferences holding the lists' lengths, as the Settings page stores them. */
    public const array LIMIT_KEYS = [self::RECENT => 'navigation.num_recent_tables', self::FAVORITE => 'navigation.num_favorite_tables'];

    /** phpMyAdmin's default NumRecentTables and NumFavoriteTables. */
    public const int DEFAULT_LIMIT = 10;

    public function __construct(
        private readonly PDO $db,
        public readonly string $server,
        public readonly string $username,
        public readonly string $list,
    ) {
    }

    public static function for(string $server, string $username, string $list): self
    {
        return new self(Storage::connection(), $server, $username, $list);
    }

    /**
     * The list, newest first, cut to the limit.
     *
     * @return list<Entry>
     */
    public function all(int $limit): array
    {
        $statement = $this->db->prepare('SELECT database, schema, name, kind FROM recent_favorite_tables WHERE server = ? AND username = ? AND list = ? ORDER BY rowid DESC LIMIT ?');
        $statement->execute([$this->server, $this->username, $this->list, max(0, $limit)]);

        return array_map(static fn (array $row): array => ['database' => (string) $row['database'], 'schema' => (string) $row['schema'], 'table' => (string) $row['name'], 'kind' => (string) $row['kind']], $statement->fetchAll());
    }

    public function count(): int
    {
        $statement = $this->db->prepare('SELECT count(*) FROM recent_favorite_tables WHERE server = ? AND username = ? AND list = ?');
        $statement->execute([$this->server, $this->username, $this->list]);

        return (int) $statement->fetchColumn();
    }

    public function has(string $database, string $schema, string $table): bool
    {
        $statement = $this->db->prepare('SELECT 1 FROM recent_favorite_tables WHERE server = ? AND username = ? AND list = ? AND database = ? AND schema = ? AND name = ?');
        $statement->execute([$this->server, $this->username, $this->list, $database, $schema, $table]);

        return $statement->fetchColumn() !== false;
    }

    /** Put the table first in the list, then drop what is beyond the limit, as phpMyAdmin's add() and trim() do. */
    public function add(string $database, string $schema, string $table, string $kind, int $limit): void
    {
        $this->db->beginTransaction();
        try {
            $this->delete($database, $schema, $table);
            $this->db->prepare('INSERT INTO recent_favorite_tables (server, username, list, database, schema, name, kind) VALUES (?, ?, ?, ?, ?, ?, ?)')
                ->execute([$this->server, $this->username, $this->list, $database, $schema, $table, $kind]);
            $this->db->prepare('DELETE FROM recent_favorite_tables WHERE server = ? AND username = ? AND list = ? AND rowid NOT IN (SELECT rowid FROM recent_favorite_tables WHERE server = ? AND username = ? AND list = ? ORDER BY rowid DESC LIMIT ?)')
                ->execute([$this->server, $this->username, $this->list, $this->server, $this->username, $this->list, max(0, $limit)]);
            $this->db->commit();
        } catch (\Throwable $e) {
            $this->db->rollBack();
            throw $e;
        }
    }

    public function delete(string $database, string $schema, string $table): void
    {
        $this->db->prepare('DELETE FROM recent_favorite_tables WHERE server = ? AND username = ? AND list = ? AND database = ? AND schema = ? AND name = ?')
            ->execute([$this->server, $this->username, $this->list, $database, $schema, $table]);
    }
}
