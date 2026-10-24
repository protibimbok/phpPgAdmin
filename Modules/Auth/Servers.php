<?php

declare(strict_types=1);

namespace PhpPgAdmin\Modules\Auth;

use PDO;
use PhpPgAdmin\Core\Database\Server;
use PhpPgAdmin\Core\Facades\Storage;

/** The saved servers, in the application storage, most recently used first. */
final class Servers
{
    public function __construct(private readonly PDO $db)
    {
    }

    public static function make(): self
    {
        return new self(Storage::connection());
    }

    /** @return list<Server> */
    public function all(): array
    {
        $servers = [];
        foreach ($this->db->query('SELECT * FROM servers ORDER BY last_used_at DESC, id') as $row) {
            $servers[] = self::hydrate($row);
        }

        return $servers;
    }

    public function find(int $id): ?Server
    {
        $statement = $this->db->prepare('SELECT * FROM servers WHERE id = ?');
        $statement->execute([$id]);
        $row = $statement->fetch();

        return $row === false ? null : self::hydrate($row);
    }

    /** The username that last signed in to the server, to pre-fill the login form. */
    public function lastUsername(int $id): ?string
    {
        $statement = $this->db->prepare('SELECT last_username FROM servers WHERE id = ?');
        $statement->execute([$id]);
        $value = $statement->fetchColumn();

        return is_string($value) && $value !== '' ? $value : null;
    }

    /**
     * Record a successful login: insert the server or update the one at the same host and port,
     * and return it with its id.
     */
    public function remember(Server $server, string $username): Server
    {
        $now = gmdate('Y-m-d\TH:i:s\Z');
        $statement = $this->db->prepare(<<<'SQL'
            INSERT INTO servers (name, host, port, sslmode, maintenance_db, last_username, last_used_at, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT (host, port) DO UPDATE SET
                sslmode = excluded.sslmode,
                maintenance_db = excluded.maintenance_db,
                last_username = excluded.last_username,
                last_used_at = excluded.last_used_at
            SQL);
        $statement->execute([$server->name, $server->host, $server->port, $server->sslmode, $server->maintenanceDb, $username, $now, $now]);

        $lookup = $this->db->prepare('SELECT id, name FROM servers WHERE host = ? AND port = ?');
        $lookup->execute([$server->host, $server->port]);
        /** @var array{id: int|string, name: string|null} $row */
        $row = $lookup->fetch();

        return $server->withId((int) $row['id'], $row['name']);
    }

    public function forget(int $id): void
    {
        $statement = $this->db->prepare('DELETE FROM servers WHERE id = ?');
        $statement->execute([$id]);
    }

    /** @param array<string, mixed> $row */
    private static function hydrate(array $row): Server
    {
        return Server::fromArray($row);
    }
}
