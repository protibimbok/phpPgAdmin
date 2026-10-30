<?php

declare(strict_types=1);

return [

    /*
    |--------------------------------------------------------------------------
    | Extra Login Security
    |--------------------------------------------------------------------------
    |
    | Refuse to sign in the usual superuser names (postgres, pgsql, root,
    | administrator) and any role with an empty password, as the classic
    | phpPgAdmin's extra_login_security does. A server trusting local
    | connections (pg_hba.conf "trust") would otherwise let anyone reaching
    | the site in as a superuser. Switch it on with
    | PGADMIN_EXTRA_LOGIN_SECURITY=1.
    |
    */

    'extra_login_security' => getenv('PGADMIN_EXTRA_LOGIN_SECURITY') === '1',

    /*
    |--------------------------------------------------------------------------
    | Owned Databases Only
    |--------------------------------------------------------------------------
    |
    | List only the databases the signed-in role owns, in the navigation tree
    | and on the Databases page, as the classic phpPgAdmin's owned_only does.
    | Superusers still see every database. It hides names only: PostgreSQL's
    | privileges still decide what a role can open. Switch it on with
    | PGADMIN_OWNED_ONLY=1.
    |
    */

    'owned_only' => getenv('PGADMIN_OWNED_ONLY') === '1',

];
