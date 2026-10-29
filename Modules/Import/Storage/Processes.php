<?php

declare(strict_types=1);

namespace PhpPgAdmin\Modules\Import\Storage;

use PDO;
use PhpPgAdmin\Core\Facades\Storage;

/**
 * A role's background processes on a server: the imports it started that have not been
 * dismissed, each with its target (a database, a schema, a table of it). Another role, or the same role on another server, does not see them.
 *
 * @phpstan-type Row array{id: string, database: string|null, schema: string|null, relation: string|null, type: string, description: string, command: list<string>, started_at: string, ended_at: string|null, exit_code: int|null}
 */
final class Processes
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
     * The processes, newest first; with a target, those started on that database (schema,
     * table), or on the server.
     *
     * @return list<Row>
     */
    public function all(bool $filtered = false, ?string $database = null, ?string $schema = null, ?string $relation = null): array
    {
        $sql = 'SELECT * FROM processes WHERE server = ? AND username = ?';
        $bindings = [$this->server, $this->username];
        if ($filtered) {
            $sql .= ' AND database IS ? AND schema IS ? AND relation IS ?';
            array_push($bindings, $database, $schema, $relation);
        }
        $statement = $this->db->prepare($sql . ' ORDER BY started_at DESC, rowid DESC');
        $statement->execute($bindings);

        return array_map(self::shape(...), $statement->fetchAll());
    }

    /** @return Row|null */
    public function find(string $id): ?array
    {
        $statement = $this->db->prepare('SELECT * FROM processes WHERE id = ? AND server = ? AND username = ?');
        $statement->execute([$id, $this->server, $this->username]);
        $row = $statement->fetch();

        return $row === false ? null : self::shape($row);
    }

    /** @param list<string> $command */
    public function create(string $id, ?string $database, ?string $schema, ?string $relation, string $type, string $description, array $command, string $startedAt): void
    {
        $this->db->prepare('INSERT INTO processes (id, server, username, database, schema, relation, type, description, command, started_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
            ->execute([$id, $this->server, $this->username, $database, $schema, $relation, $type, $description, json_encode($command, JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR), $startedAt]);
    }

    public function finish(string $id, string $endedAt, ?int $exitCode): void
    {
        $this->db->prepare('UPDATE processes SET ended_at = ?, exit_code = ? WHERE id = ? AND server = ? AND username = ?')
            ->execute([$endedAt, $exitCode, $id, $this->server, $this->username]);
    }

    public function delete(string $id): bool
    {
        $statement = $this->db->prepare('DELETE FROM processes WHERE id = ? AND server = ? AND username = ?');
        $statement->execute([$id, $this->server, $this->username]);

        return $statement->rowCount() > 0;
    }

    /**
     * @param array<string, mixed> $row
     * @return Row
     */
    private static function shape(array $row): array
    {
        $command = json_decode((string) $row['command'], true);

        return [
            'id' => (string) $row['id'],
            'database' => $row['database'] === null ? null : (string) $row['database'],
            'schema' => $row['schema'] === null ? null : (string) $row['schema'],
            'relation' => ($row['relation'] ?? null) === null ? null : (string) $row['relation'],
            'type' => (string) $row['type'],
            'description' => (string) $row['description'],
            'command' => is_array($command) ? array_map('strval', $command) : [],
            'started_at' => (string) $row['started_at'],
            'ended_at' => $row['ended_at'] === null ? null : (string) $row['ended_at'],
            'exit_code' => $row['exit_code'] === null ? null : (int) $row['exit_code'],
        ];
    }
}
