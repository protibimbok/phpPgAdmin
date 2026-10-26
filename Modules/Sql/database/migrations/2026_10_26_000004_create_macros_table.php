<?php

declare(strict_types=1);

use PhpPgAdmin\Core\Storage\Migration;

/**
 * Query macros, after pgAdmin's user_macros: a named statement a role keeps on a server,
 * optionally bound to one of the fixed shortcut keys (Ctrl+0…9, Alt+F1…F12), that the SQL
 * page runs from its Macros menu or the key.
 */
return new class implements Migration {
    public function up(PDO $db): void
    {
        $db->exec(<<<'SQL'
            CREATE TABLE macros (
                id         INTEGER PRIMARY KEY AUTOINCREMENT,
                server     TEXT NOT NULL,
                username   TEXT NOT NULL,
                key        TEXT,
                name       TEXT NOT NULL,
                sql        TEXT NOT NULL,
                created_at TEXT NOT NULL
            )
            SQL);
        $db->exec('CREATE INDEX macros_owner ON macros (server, username)');
    }
};
