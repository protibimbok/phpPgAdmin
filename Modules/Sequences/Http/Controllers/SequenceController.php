<?php

declare(strict_types=1);

namespace PhpPgAdmin\Modules\Sequences\Http\Controllers;

use PhpPgAdmin\Core\Nodes\RelationController;

/** The sequence node, after pgAdmin's SequenceView. */
final class SequenceController extends RelationController
{
    protected function relkinds(): array
    {
        return ['S'];
    }
}
