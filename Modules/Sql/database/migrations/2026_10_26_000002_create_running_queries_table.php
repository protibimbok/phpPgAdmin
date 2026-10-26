<?php

declare(strict_types=1);

use PhpPgAdmin\Core\Storage\Migration;

/**
 * The statements being run right now, by the request id the client made up, so a "cancel"
 * request can find the backend to signal. Rows are removed when the request ends.
 */
return new class implements Migration {
    public function up(PDO $db): void
    {
        $db->exec(<<<'SQL'
            CREATE TABLE running_queries (
                request_id  TEXT PRIMARY KEY,
                server      TEXT NOT NULL,
                username    TEXT NOT NULL,
                database    TEXT NOT NULL,
                backend_pid INTEGER NOT NULL,
                started_at  TEXT NOT NULL
            )
            SQL);
    }
};
