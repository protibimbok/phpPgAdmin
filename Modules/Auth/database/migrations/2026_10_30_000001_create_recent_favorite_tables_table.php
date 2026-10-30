<?php

declare(strict_types=1);

use PhpPgAdmin\Core\Storage\Migration;

/**
 * A role's recently used and favorite tables on a server, like phpMyAdmin's pma__recent and
 * pma__favorite: one row per table and list ("recent" or "favorite"), the newest the highest
 * rowid. The table is named by its database, schema and name, with the kind of relation its
 * pages are addressed by (table, view, mview).
 */
return new class implements Migration {
    public function up(PDO $db): void
    {
        $db->exec(<<<'SQL'
            CREATE TABLE recent_favorite_tables (
                server   TEXT NOT NULL,
                username TEXT NOT NULL,
                list     TEXT NOT NULL,
                database TEXT NOT NULL,
                schema   TEXT NOT NULL,
                name     TEXT NOT NULL,
                kind     TEXT NOT NULL,
                UNIQUE (server, username, list, database, schema, name)
            )
            SQL);
    }
};
