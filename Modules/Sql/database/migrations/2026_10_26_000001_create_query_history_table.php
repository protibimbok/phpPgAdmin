<?php

declare(strict_types=1);

use PhpPgAdmin\Core\Storage\Migration;

/**
 * Every statement a role ran from the SQL page or the Browse grid, with its outcome, the way
 * pgAdmin's query_history table keeps them: per server and role, newest first.
 */
return new class implements Migration {
    public function up(PDO $db): void
    {
        $db->exec(<<<'SQL'
            CREATE TABLE query_history (
                id            INTEGER PRIMARY KEY AUTOINCREMENT,
                server        TEXT NOT NULL,
                username      TEXT NOT NULL,
                database      TEXT NOT NULL,
                sql           TEXT NOT NULL,
                status        TEXT NOT NULL,
                affected_rows INTEGER,
                duration_ms   REAL,
                message       TEXT,
                started_at    TEXT NOT NULL
            )
            SQL);
        $db->exec('CREATE INDEX query_history_owner ON query_history (server, username, started_at)');
    }
};
