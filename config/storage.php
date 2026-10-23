<?php

declare(strict_types=1);

return [

    /*
    |--------------------------------------------------------------------------
    | Application Storage
    |--------------------------------------------------------------------------
    |
    | phpPgAdmin's own database, which holds what is not PostgreSQL's: the
    | preferences, history and bookmarks of the roles that sign in. It is an
    | SQLite file, like pgAdmin's pgadmin4.db, created and migrated on first
    | use. Point PGADMIN_STORAGE_PATH elsewhere to keep it outside the project.
    |
    */

    'path' => getenv('PGADMIN_STORAGE_PATH') ?: dirname(__DIR__) . '/storage/phppgadmin.sqlite',

];
