<?php

declare(strict_types=1);

namespace PhpPgAdmin\Modules\Routines\Http\Controllers;

/** The trigger function node, after pgAdmin's TriggerFunctionView: the functions returning trigger or event_trigger. */
final class TriggerFunctionController extends RoutineController
{
    protected function kind(): string
    {
        return 'trigger_function';
    }
}
