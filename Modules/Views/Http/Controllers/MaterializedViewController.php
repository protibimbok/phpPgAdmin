<?php

declare(strict_types=1);

namespace PhpPgAdmin\Modules\Views\Http\Controllers;

use PhpPgAdmin\Core\Nodes\NodeContext;
use PhpPgAdmin\Core\Nodes\RelationController;

/** The materialized view node, after pgAdmin's MViewNode. */
final class MaterializedViewController extends RelationController
{
    protected function relkinds(): array
    {
        return ['m'];
    }

    protected function icon(NodeContext $ctx, array $row): string
    {
        return 'b_views';
    }
}
