<?php

declare(strict_types=1);

use PhpPgAdmin\Core\Storage\Migration;

/**
 * The Designer's pages, after phpMyAdmin's pdf_pages and table_coords: a named layout of a
 * database's tables (where each sits, which are shown, which are folded) that a role saved on
 * a server, with the diagram's settings.
 */
return new class implements Migration {
    public function up(PDO $db): void
    {
        $db->exec(<<<'SQL'
            CREATE TABLE designer_pages (
                id         INTEGER PRIMARY KEY AUTOINCREMENT,
                server     TEXT NOT NULL,
                username   TEXT NOT NULL,
                database   TEXT NOT NULL,
                name       TEXT NOT NULL,
                layout     TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                UNIQUE (server, username, database, name)
            )
            SQL);
    }
};
