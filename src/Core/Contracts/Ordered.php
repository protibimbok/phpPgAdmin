<?php

declare(strict_types=1);

namespace PhpPgAdmin\Core\Contracts;

interface Ordered
{
    /**
     * The position in which the module is wired. Lower comes first; a negative order comes last.
     */
    public function order(): int;
}
