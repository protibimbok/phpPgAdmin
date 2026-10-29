<?php

declare(strict_types=1);

use PhpPgAdmin\Core\Storage\Migration;

/** The table a COPY import loads, so that its Import page lists the imports into it alone. */
return new class implements Migration {
    public function up(PDO $db): void
    {
        $db->exec('ALTER TABLE processes ADD COLUMN relation TEXT');
    }
};
