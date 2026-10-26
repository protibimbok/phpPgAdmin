<?php

declare(strict_types=1);

namespace PhpPgAdmin\Modules\Views\Http\Controllers;

use PhpPgAdmin\Core\Nodes\NodeContext;
use PhpPgAdmin\Core\Nodes\RelationController;

/** The view node, after pgAdmin's ViewNode. */
final class ViewController extends RelationController
{
    protected function relkinds(): array
    {
        return ['v'];
    }

    protected function icon(NodeContext $ctx, array $row): string
    {
        return 'b_views';
    }
}
