<?php

declare(strict_types=1);

use PhpPgAdmin\Core\Storage\Migration;

/**
 * Per-role settings, like phpMyAdmin's "userconfig" table: one JSON value per key, for a role
 * on a server. "server" is "host:port" of the PostgreSQL server the role signed in to.
 */
return new class implements Migration {
    public function up(PDO $db): void
    {
        $db->exec(<<<'SQL'
            CREATE TABLE preferences (
                server     TEXT NOT NULL,
                username   TEXT NOT NULL,
                key        TEXT NOT NULL,
                value      TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                PRIMARY KEY (server, username, key)
            )
            SQL);
    }
};
