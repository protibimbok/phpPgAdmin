<?php

declare(strict_types=1);

namespace PhpPgAdmin\Modules\Designer\Storage;

use PDO;
use PhpPgAdmin\Core\Facades\Storage;

/**
 * A role's Designer pages on a server: per database, named layouts of the diagram.
 *
 * @phpstan-type Page array{id: int, name: string, layout: array<string, mixed>, updated_at: string}
 */
final class DesignerPages
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

    /** @return list<Page> the database's pages, by name */
    public function all(string $database): array
    {
        $statement = $this->db->prepare('SELECT id, name, layout, updated_at FROM designer_pages WHERE server = ? AND username = ? AND database = ? ORDER BY name');
        $statement->execute([$this->server, $this->username, $database]);

        return array_map(self::shape(...), $statement->fetchAll());
    }

    /** @return Page|null */
    public function find(int $id): ?array
    {
        $statement = $this->db->prepare('SELECT id, name, layout, updated_at FROM designer_pages WHERE id = ? AND server = ? AND username = ?');
        $statement->execute([$id, $this->server, $this->username]);
        $row = $statement->fetch();

        return $row === false ? null : self::shape($row);
    }

    public function findByName(string $database, string $name): ?int
    {
        $statement = $this->db->prepare('SELECT id FROM designer_pages WHERE server = ? AND username = ? AND database = ? AND name = ?');
        $statement->execute([$this->server, $this->username, $database, $name]);
        $id = $statement->fetchColumn();

        return $id === false ? null : (int) $id;
    }

    /** Save a page by name: a new one, or the one of that name replaced. */
    public function save(string $database, string $name, array $layout): int
    {
        $this->db->prepare(<<<'SQL'
            INSERT INTO designer_pages (server, username, database, name, layout, updated_at) VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT (server, username, database, name) DO UPDATE SET layout = excluded.layout, updated_at = excluded.updated_at
            SQL)->execute([$this->server, $this->username, $database, $name, json_encode($layout, JSON_THROW_ON_ERROR | JSON_UNESCAPED_UNICODE), gmdate('Y-m-d\TH:i:s\Z')]);

        return (int) $this->findByName($database, $name);
    }

    public function delete(int $id): bool
    {
        $statement = $this->db->prepare('DELETE FROM designer_pages WHERE id = ? AND server = ? AND username = ?');
        $statement->execute([$id, $this->server, $this->username]);

        return $statement->rowCount() > 0;
    }

    /** @return Page */
    private static function shape(array $row): array
    {
        $layout = json_decode((string) $row['layout'], true);

        return ['id' => (int) $row['id'], 'name' => (string) $row['name'], 'layout' => is_array($layout) ? $layout : [], 'updated_at' => (string) $row['updated_at']];
    }
}
