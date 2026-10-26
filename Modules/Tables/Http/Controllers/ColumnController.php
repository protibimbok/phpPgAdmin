<?php

declare(strict_types=1);

namespace PhpPgAdmin\Modules\Tables\Http\Controllers;

use PhpPgAdmin\Core\Nodes\NodeContext;

/** The column node, after pgAdmin's ColumnsView. A column's id is its attribute number. */
final class ColumnController extends TableChildController
{
    protected function toNode(NodeContext $ctx, array $row): array
    {
        $node = parent::toNode($ctx, $row);
        $node['inode'] = false;

        return $node;
    }
}
