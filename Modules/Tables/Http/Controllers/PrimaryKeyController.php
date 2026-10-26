<?php

declare(strict_types=1);

namespace PhpPgAdmin\Modules\Tables\Http\Controllers;

final class PrimaryKeyController extends IndexConstraintController
{
    protected function constraintType(): string
    {
        return 'p';
    }
}
