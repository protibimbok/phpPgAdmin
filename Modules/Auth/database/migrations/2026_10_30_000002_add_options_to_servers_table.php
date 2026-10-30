<?php

declare(strict_types=1);

use PhpPgAdmin\Core\Storage\Migration;

/**
 * pgAdmin's connection options of a saved server, as JSON: the server's (service, application
 * name, SSL file names) and, under "roles", each role's own (the role to SET ROLE to, the
 * post-connection SQL). Null for a server without any.
 */
return new class implements Migration {
    public function up(PDO $db): void
    {
        $db->exec('ALTER TABLE servers ADD COLUMN options TEXT');
    }
};
