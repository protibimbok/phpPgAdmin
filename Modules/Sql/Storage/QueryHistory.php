<?php

declare(strict_types=1);

namespace PhpPgAdmin\Modules\Sql\Storage;

use PDO;
use PhpPgAdmin\Core\Facades\Storage;
use PhpPgAdmin\Modules\Auth\Preferences;

/** The statements a role ran on a server, newest first, kept to the number the role's settings say. */
final class QueryHistory
{
    /** How many entries a role keeps on a server; the oldest go when it is exceeded. */
    public const int LIMIT = 500;

    /** The setting that shortens the history (QueryHistoryMax); the frontend registers it. */
    public const string PREFERENCE = 'sql.query_history_max';

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
     * The newest entries, newest first, for one database or all.
     *
     * @return list<array<string, mixed>>
     */
    public function all(int $limit = 100, ?string $database = null): array
    {
        $sql = 'SELECT id, database, sql, status, affected_rows, duration_ms, message, started_at FROM query_history WHERE server = ? AND username = ?';
        $params = [$this->server, $this->username];
        if ($database !== null) {
            $sql .= ' AND database = ?';
            $params[] = $database;
        }
        $statement = $this->db->prepare($sql . ' ORDER BY id DESC LIMIT ' . max(1, min($limit, self::LIMIT)));
        $statement->execute($params);

        return array_map(static fn (array $row): array => [...$row, 'id' => (int) $row['id'], 'affected_rows' => $row['affected_rows'] === null ? null : (int) $row['affected_rows'], 'duration_ms' => $row['duration_ms'] === null ? null : (float) $row['duration_ms']], $statement->fetchAll());
    }

    public function record(string $database, string $sql, string $status, ?int $affectedRows, ?float $durationMs, ?string $message, string $startedAt): void
    {
        $this->db->prepare(<<<'SQL'
            INSERT INTO query_history (server, username, database, sql, status, affected_rows, duration_ms, message, started_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            SQL)->execute([$this->server, $this->username, $database, $sql, $status, $affectedRows, $durationMs, $message, $startedAt]);

        $this->db->prepare(<<<'SQL'
            DELETE FROM query_history WHERE server = ? AND username = ? AND id NOT IN (
                SELECT id FROM query_history WHERE server = ? AND username = ? ORDER BY id DESC LIMIT ?
            )
            SQL)->execute([$this->server, $this->username, $this->server, $this->username, $this->kept()]);
    }

    /** How many entries are kept: the role's "Query history length" setting, at most LIMIT. */
    private function kept(): int
    {
        $setting = (new Preferences($this->db, $this->server, $this->username))->get(self::PREFERENCE, self::LIMIT);

        return is_int($setting) ? max(1, min($setting, self::LIMIT)) : self::LIMIT;
    }
}
