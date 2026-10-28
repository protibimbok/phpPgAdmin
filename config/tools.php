<?php

declare(strict_types=1);

return [

    /*
    |--------------------------------------------------------------------------
    | PostgreSQL Client Programs
    |--------------------------------------------------------------------------
    |
    | The directory holding pg_dump and pg_dumpall, which the Export pages run.
    | When it is null they are looked for on the PATH and in the places the
    | packages install them (/usr/lib/postgresql/<major>/bin, /usr/pgsql-<major>/bin,
    | Homebrew's postgresql@<major>), and the newest found is used: pg_dump must
    | be at least as new as the server it dumps. Override it with
    | PGADMIN_PG_BIN_DIR.
    |
    */

    'bin_dir' => getenv('PGADMIN_PG_BIN_DIR') ?: null,

];
