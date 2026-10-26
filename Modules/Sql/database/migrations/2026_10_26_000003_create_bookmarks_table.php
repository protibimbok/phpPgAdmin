<?php

declare(strict_types=1);

use PhpPgAdmin\Core\Storage\Migration;

/**
 * Saved queries, as phpMyAdmin's bookmark table keeps them: a label and the statement, for one
 * database on one server, belonging to a role or shared with everyone on that server.
 */
return new class implements Migration {
    public function up(PDO $db): void
    {
        $db->exec(<<<'SQL'
            CREATE TABLE bookmarks (
                id         INTEGER PRIMARY KEY AUTOINCREMENT,
                server     TEXT NOT NULL,
                username   TEXT,
                database   TEXT NOT NULL,
                label      TEXT NOT NULL,
                sql        TEXT NOT NULL,
                shared     INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL
            )
            SQL);
        $db->exec('CREATE INDEX bookmarks_owner ON bookmarks (server, username, database)');
    }
};
