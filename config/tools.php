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

    /*
    |--------------------------------------------------------------------------
    | PHP Command Line
    |--------------------------------------------------------------------------
    |
    | The PHP CLI binary that runs bin/process-runner.php, which watches an
    | import in the background. When it is null the php next to the running
    | PHP is used (PHP_BINDIR/php under php-fpm). Override it with
    | PGADMIN_PHP_BINARY.
    |
    */

    'php_binary' => getenv('PGADMIN_PHP_BINARY') ?: null,

    /*
    |--------------------------------------------------------------------------
    | PL/pgSQL Debugger
    |--------------------------------------------------------------------------
    |
    | Whether a PL/pgSQL function or procedure offers Debug. It takes the
    | pldbgapi extension (EDB's pldebugger) in the database and
    | shared_preload_libraries = 'plugin_debugger' on the server; without them
    | the Debug button does not appear. Switch it off with PGADMIN_DEBUGGER=0.
    |
    */

    'debugger' => getenv('PGADMIN_DEBUGGER') !== '0',

];
