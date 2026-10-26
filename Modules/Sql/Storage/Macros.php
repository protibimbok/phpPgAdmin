<?php

declare(strict_types=1);

namespace PhpPgAdmin\Modules\Sql\Storage;

use PDO;
use PhpPgAdmin\Core\Facades\Storage;

/**
 * A role's query macros on a server, after pgAdmin's Macros + UserMacros: a name, the
 * statement, and at most one of the fixed shortcut keys each. Names and keys are unique per
 * role and server.
 */
final class Macros
{
    /** The shortcut keys pgAdmin seeds, in its order: Ctrl+1…9, Ctrl+0, Alt+F1…F12. */
    public const array KEYS = ['Ctrl+1', 'Ctrl+2', 'Ctrl+3', 'Ctrl+4', 'Ctrl+5', 'Ctrl+6', 'Ctrl+7', 'Ctrl+8', 'Ctrl+9', 'Ctrl+0', 'Alt+F1', 'Alt+F2', 'Alt+F3', 'Alt+F4', 'Alt+F5', 'Alt+F6', 'Alt+F7', 'Alt+F8', 'Alt+F9', 'Alt+F10', 'Alt+F11', 'Alt+F12'];

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

    /** @return list<array<string, mixed>> the role's macros, by name */
    public function all(): array
    {
        $statement = $this->db->prepare('SELECT id, key, name, sql, created_at FROM macros WHERE server = ? AND username = ? ORDER BY name COLLATE NOCASE, id');
        $statement->execute([$this->server, $this->username]);

        return array_map(self::shape(...), $statement->fetchAll());
    }

    /** @return array<string, mixed>|null */
    public function find(int $id): ?array
    {
        $statement = $this->db->prepare('SELECT id, key, name, sql, created_at FROM macros WHERE id = ? AND server = ? AND username = ?');
        $statement->execute([$id, $this->server, $this->username]);
        $row = $statement->fetch();

        return $row === false ? null : self::shape($row);
    }

    /** The macro of this role's, other than $except, that holds the name (case-insensitively) or the key. */
    public function conflict(string $name, ?string $key, ?int $except = null): ?string
    {
        $statement = $this->db->prepare('SELECT name, key FROM macros WHERE server = ? AND username = ? AND id IS NOT ? AND (lower(name) = lower(?) OR (? IS NOT NULL AND key = ?))');
        $statement->execute([$this->server, $this->username, $except, $name, $key, $key]);
        $row = $statement->fetch();
        if ($row === false) {
            return null;
        }

        return strcasecmp((string) $row['name'], $name) === 0 ? 'name' : 'key';
    }

    /** @return array<string, mixed> the stored macro */
    public function create(string $name, string $sql, ?string $key): array
    {
        $this->db->prepare('INSERT INTO macros (server, username, key, name, sql, created_at) VALUES (?, ?, ?, ?, ?, ?)')
            ->execute([$this->server, $this->username, $key, $name, $sql, gmdate('Y-m-d\TH:i:s\Z')]);

        return $this->find((int) $this->db->lastInsertId()) ?? [];
    }

    /** @return array<string, mixed>|null the macro as it now stands, or null when it is not this role's */
    public function update(int $id, string $name, string $sql, ?string $key): ?array
    {
        $statement = $this->db->prepare('UPDATE macros SET key = ?, name = ?, sql = ? WHERE id = ? AND server = ? AND username = ?');
        $statement->execute([$key, $name, $sql, $id, $this->server, $this->username]);

        return $statement->rowCount() > 0 ? $this->find($id) : null;
    }

    /** Remove a macro of this role's; true when one was removed. */
    public function delete(int $id): bool
    {
        $statement = $this->db->prepare('DELETE FROM macros WHERE id = ? AND server = ? AND username = ?');
        $statement->execute([$id, $this->server, $this->username]);

        return $statement->rowCount() > 0;
    }

    /**
     * @param array<string, mixed> $row
     * @return array<string, mixed>
     */
    private static function shape(array $row): array
    {
        return [...$row, 'id' => (int) $row['id'], 'key' => $row['key'] === '' ? null : $row['key']];
    }
}
