<?php

declare(strict_types=1);

use PhpPgAdmin\Core\Storage\Migration;

/**
 * The servers logins have succeeded against, offered again on the login page. No password is
 * kept; "last_username" only pre-fills the form. One row per host and port.
 */
return new class implements Migration {
    public function up(PDO $db): void
    {
        $db->exec(<<<'SQL'
            CREATE TABLE servers (
                id             INTEGER PRIMARY KEY AUTOINCREMENT,
                name           TEXT,
                host           TEXT NOT NULL,
                port           INTEGER NOT NULL,
                sslmode        TEXT NOT NULL DEFAULT 'prefer',
                maintenance_db TEXT,
                last_username  TEXT,
                last_used_at   TEXT NOT NULL,
                created_at     TEXT NOT NULL,
                UNIQUE (host, port)
            )
            SQL);
    }
};
