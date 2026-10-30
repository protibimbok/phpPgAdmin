<?php

declare(strict_types=1);

return [

    /*
    |--------------------------------------------------------------------------
    | Default PostgreSQL Server
    |--------------------------------------------------------------------------
    |
    | The server the login page offers first; the form's "Advanced" section
    | lets a login go to another one, and servers a login succeeded against
    | are remembered. "host" is a hostname, an IP address, or the directory
    | of a Unix socket; "port" is the TCP port the server listens on;
    | "sslmode" is libpq's (disable, allow, prefer, require, verify-ca,
    | verify-full). Each can be overridden from the environment with
    | PGADMIN_DB_HOST, PGADMIN_DB_PORT and PGADMIN_DB_SSLMODE.
    |
    | "database" is where a login connects first. When it is null, the first
    | of "postgres", "template1" and the role's own database that lets the
    | role in is used, and the databases are listed from there.
    |
    */

    'host' => getenv('PGADMIN_DB_HOST') ?: 'localhost',

    'port' => (int) (getenv('PGADMIN_DB_PORT') ?: 5432),

    'sslmode' => getenv('PGADMIN_DB_SSLMODE') ?: 'prefer',

    'database' => getenv('PGADMIN_DB_DATABASE') ?: null,

    /*
    |--------------------------------------------------------------------------
    | Connection Timeout
    |--------------------------------------------------------------------------
    |
    | Seconds to wait for the server before a connection is reported as failed.
    |
    */

    'timeout' => (int) (getenv('PGADMIN_DB_TIMEOUT') ?: 10),

    /*
    |--------------------------------------------------------------------------
    | SSL Certificate Directory
    |--------------------------------------------------------------------------
    |
    | The directory on the web server that a saved server's client
    | certificate, key, root certificate and revocation list are picked
    | from (Connection options of the saved servers). Only the names of
    | files directly in it can be chosen, never another path. Null turns
    | the SSL file options off.
    |
    */

    'ssl_directory' => getenv('PGADMIN_SSL_DIRECTORY') ?: null,

];
