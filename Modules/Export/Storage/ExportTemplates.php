<?php

declare(strict_types=1);

namespace PhpPgAdmin\Modules\Export\Storage;

use PDO;
use PhpPgAdmin\Core\Facades\Storage;

/**
 * A role's export templates on a server, phpMyAdmin's Export templates card: the page's
 * options under a name, per kind of export. Names are unique per role, server and kind.
 */
final class ExportTemplates
{
    public const array TYPES = ['server', 'database', 'schema', 'table'];

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

    /** @return list<array{id: int, name: string, data: array<string, mixed>}> the templates of one kind, by name */
    public function all(string $type): array
    {
        $statement = $this->db->prepare('SELECT id, name, data FROM export_templates WHERE server = ? AND username = ? AND export_type = ? ORDER BY name COLLATE NOCASE, id');
        $statement->execute([$this->server, $this->username, $type]);

        return array_map(self::shape(...), $statement->fetchAll());
    }

    /** @return array{id: int, name: string, data: array<string, mixed>}|null */
    public function find(int $id): ?array
    {
        $statement = $this->db->prepare('SELECT id, name, data FROM export_templates WHERE id = ? AND server = ? AND username = ?');
        $statement->execute([$id, $this->server, $this->username]);
        $row = $statement->fetch();

        return $row === false ? null : self::shape($row);
    }

    public function exists(string $type, string $name): bool
    {
        $statement = $this->db->prepare('SELECT 1 FROM export_templates WHERE server = ? AND username = ? AND export_type = ? AND lower(name) = lower(?)');
        $statement->execute([$this->server, $this->username, $type, $name]);

        return $statement->fetchColumn() !== false;
    }

    /**
     * @param array<string, mixed> $data
     * @return array{id: int, name: string, data: array<string, mixed>}
     */
    public function create(string $type, string $name, array $data): array
    {
        $this->db->prepare('INSERT INTO export_templates (server, username, export_type, name, data, created_at) VALUES (?, ?, ?, ?, ?, ?)')
            ->execute([$this->server, $this->username, $type, $name, json_encode($data, JSON_THROW_ON_ERROR), gmdate('Y-m-d\TH:i:s\Z')]);

        return $this->find((int) $this->db->lastInsertId()) ?? throw new \LogicException('The template just stored is gone.');
    }

    /**
     * @param array<string, mixed> $data
     * @return array{id: int, name: string, data: array<string, mixed>}|null the template as it now stands, or null when it is not this role's
     */
    public function update(int $id, array $data): ?array
    {
        $statement = $this->db->prepare('UPDATE export_templates SET data = ? WHERE id = ? AND server = ? AND username = ?');
        $statement->execute([json_encode($data, JSON_THROW_ON_ERROR), $id, $this->server, $this->username]);

        return $statement->rowCount() > 0 ? $this->find($id) : null;
    }

    public function delete(int $id): bool
    {
        $statement = $this->db->prepare('DELETE FROM export_templates WHERE id = ? AND server = ? AND username = ?');
        $statement->execute([$id, $this->server, $this->username]);

        return $statement->rowCount() > 0;
    }

    /**
     * @param array<string, mixed> $row
     * @return array{id: int, name: string, data: array<string, mixed>}
     */
    private static function shape(array $row): array
    {
        $data = json_decode((string) $row['data'], true);

        return ['id' => (int) $row['id'], 'name' => (string) $row['name'], 'data' => is_array($data) ? $data : []];
    }
}
