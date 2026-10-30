<?php

declare(strict_types=1);

namespace PhpPgAdmin\Core\Contracts;

use PhpPgAdmin\Core\Database\ConnectionPool;

interface EndsWithSignOut
{
    /**
     * End what the module keeps for the sign-in that is signing out (background sessions holding
     * a connection), before its credentials leave the PHP session. The pool is the sign-in's,
     * or null when it can no longer connect.
     */
    public function signOut(?ConnectionPool $pool): void;
}
