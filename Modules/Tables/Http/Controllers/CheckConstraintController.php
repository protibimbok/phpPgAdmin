<?php

declare(strict_types=1);

namespace PhpPgAdmin\Modules\Tables\Http\Controllers;

/** The check constraint node, after pgAdmin's CheckConstraintView. */
final class CheckConstraintController extends ConstraintController
{
    protected function constraintKind(): string
    {
        return 'check_constraint';
    }
}
