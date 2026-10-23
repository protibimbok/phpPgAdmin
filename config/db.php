<?php

declare(strict_types=1);

return [

    /*
    |--------------------------------------------------------------------------
    | PostgreSQL Server
    |--------------------------------------------------------------------------
    |
    | The server the UI administers and that logins are verified against.
    | "host" is a hostname, an IP address, or the directory of a Unix socket;
    | "port" is the TCP port the server listens on. Both can be overridden
    | from the environment with PGADMIN_DB_HOST and PGADMIN_DB_PORT.
    |
    | No database is configured: a login connects to the first of "postgres",
    | "template1" and the role's own database that lets the role in, and the
    | databases are listed from there.
    |
    */

    'host' => getenv('PGADMIN_DB_HOST') ?: 'localhost',

    'port' => (int) (getenv('PGADMIN_DB_PORT') ?: 5432),

    /*
    |--------------------------------------------------------------------------
    | Connection Timeout
    |--------------------------------------------------------------------------
    |
    | Seconds to wait for the server before a connection is reported as failed.
    |
    */

    'timeout' => (int) (getenv('PGADMIN_DB_TIMEOUT') ?: 10),

];
