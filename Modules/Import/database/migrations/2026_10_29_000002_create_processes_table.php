<?php

declare(strict_types=1);

use PhpPgAdmin\Core\Storage\Migration;

/**
 * Background processes, after pgAdmin's process table: an import a role started on a server,
 * its target, what it runs (the command without the environment), and when it ended. Its
 * output and status are in the process's directory until it is dismissed.
 */
return new class implements Migration {
    public function up(PDO $db): void
    {
        $db->exec(<<<'SQL'
            CREATE TABLE processes (
                id          TEXT PRIMARY KEY,
                server      TEXT NOT NULL,
                username    TEXT NOT NULL,
                database    TEXT,
                schema      TEXT,
                type        TEXT NOT NULL,
                description TEXT NOT NULL,
                command     TEXT NOT NULL,
                started_at  TEXT NOT NULL,
                ended_at    TEXT,
                exit_code   INTEGER
            )
            SQL);
        $db->exec('CREATE INDEX processes_owner ON processes (server, username, started_at)');
    }
};
