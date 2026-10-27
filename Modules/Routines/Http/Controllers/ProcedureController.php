<?php

declare(strict_types=1);

namespace PhpPgAdmin\Modules\Routines\Http\Controllers;

/** The procedure node (PostgreSQL 11+), after pgAdmin's ProcedureView. */
final class ProcedureController extends RoutineController
{
    protected function kind(): string
    {
        return 'procedure';
    }
}
