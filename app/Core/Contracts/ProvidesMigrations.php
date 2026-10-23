<?php

declare(strict_types=1);

namespace PhpPgAdmin\Core\Contracts;

interface ProvidesMigrations
{
    /**
     * The directory holding the module's migrations of the application storage, relative to the
     * module's path, e.g. "database/migrations". Each <name>.php in it returns a Storage\Migration;
     * the files run once each, in name order, so name them "YYYY_MM_DD_NNNNNN_what_it_does.php".
     */
    public function migrationsPath(): string;
}
