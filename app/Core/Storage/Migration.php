<?php

declare(strict_types=1);

namespace PhpPgAdmin\Core\Storage;

use PDO;

/** One step of the application storage's schema. A migration file returns an instance, usually an anonymous class. */
interface Migration
{
    public function up(PDO $db): void;
}
