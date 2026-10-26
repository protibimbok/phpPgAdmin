<?php

declare(strict_types=1);

namespace PhpPgAdmin\Modules\Sql\Storage;

use PDO;
use PhpPgAdmin\Core\Facades\Storage;

/**
 * The requests running statements right now, by the id the client made up for each, with the
 * backend serving it: what a cancel request needs to signal the right process. A row belongs
 * to the role that registered it; nobody else may cancel it.
 */
final class RunningQueries
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

    public function register(string $requestId, string $database, int $backendPid): void
    {
        $this->db->prepare(<<<'SQL'
            INSERT INTO running_queries (request_id, server, username, database, backend_pid, started_at) VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT (request_id) DO UPDATE SET backend_pid = excluded.backend_pid, started_at = excluded.started_at
            SQL)->execute([$requestId, $this->server, $this->username, $database, $backendPid, gmdate('Y-m-d\TH:i:s\Z')]);
    }

    public function unregister(string $requestId): void
    {
        $this->db->prepare('DELETE FROM running_queries WHERE request_id = ? AND server = ? AND username = ?')->execute([$requestId, $this->server, $this->username]);
    }

    /** The backend running the request, when it is this role's and still running. */
    public function backendPid(string $requestId): ?int
    {
        $statement = $this->db->prepare('SELECT backend_pid FROM running_queries WHERE request_id = ? AND server = ? AND username = ?');
        $statement->execute([$requestId, $this->server, $this->username]);
        $pid = $statement->fetchColumn();

        return $pid === false ? null : (int) $pid;
    }
}
