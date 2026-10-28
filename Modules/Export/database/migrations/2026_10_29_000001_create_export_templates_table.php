<?php

declare(strict_types=1);

use PhpPgAdmin\Core\Storage\Migration;

/**
 * Export templates, after phpMyAdmin's pma__export_templates: a role's named set of Export page
 * options on a server, for one kind of export (server, database, schema or table).
 */
return new class implements Migration {
    public function up(PDO $db): void
    {
        $db->exec(<<<'SQL'
            CREATE TABLE export_templates (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                server      TEXT NOT NULL,
                username    TEXT NOT NULL,
                export_type TEXT NOT NULL,
                name        TEXT NOT NULL,
                data        TEXT NOT NULL,
                created_at  TEXT NOT NULL,
                UNIQUE (server, username, export_type, name)
            )
            SQL);
    }
};
