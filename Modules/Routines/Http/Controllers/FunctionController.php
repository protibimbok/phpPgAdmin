<?php

declare(strict_types=1);

namespace PhpPgAdmin\Modules\Routines\Http\Controllers;

/** The function node, after pgAdmin's FunctionView. */
final class FunctionController extends RoutineController
{
    protected function kind(): string
    {
        return 'function';
    }
}
