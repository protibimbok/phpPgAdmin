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

    /*
    |--------------------------------------------------------------------------
    | Background Processes
    |--------------------------------------------------------------------------
    |
    | Where an import runs from: each one gets a directory holding the file
    | uploaded, the program's output and its status, removed when the import
    | is dismissed. Override it with PGADMIN_PROCESS_DIR.
    |
    */

    'processes' => getenv('PGADMIN_PROCESS_DIR') ?: dirname(__DIR__) . '/storage/processes',

    /*
    |--------------------------------------------------------------------------
    | Upload Directory
    |--------------------------------------------------------------------------
    |
    | phpMyAdmin's UploadDir: a directory on the web server whose files the
    | Import pages offer besides an upload, for files larger than PHP and the
    | web server accept in a request. Null leaves it out. Set it with
    | PGADMIN_UPLOAD_DIR.
    |
    */

    'upload_dir' => getenv('PGADMIN_UPLOAD_DIR') ?: null,

];
