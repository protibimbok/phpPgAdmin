<?php

declare(strict_types=1);

namespace PhpPgAdmin\Modules\Tables\Http\Controllers;

final class UniqueConstraintController extends IndexConstraintController
{
    protected function constraintType(): string
    {
        return 'u';
    }
}
