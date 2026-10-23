<?php

declare(strict_types=1);

namespace PhpPgAdmin\Core\Contracts;

interface Module
{
    /**
     * The unique, kebab-case name of the module, e.g. "auth".
     */
    public function name(): string;

    /**
     * The absolute path to the module's root directory. Paths the module provides are relative to it.
     */
    public function path(): string;
}
