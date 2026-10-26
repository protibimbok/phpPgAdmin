<?php

declare(strict_types=1);

namespace PhpPgAdmin\Modules\Tables\Http\Controllers;

use PhpPgAdmin\Core\Nodes\NodeContext;
use PhpPgAdmin\Modules\Tables\Ddl\IndexDdl;

/** The index node, after pgAdmin's IndexesView: the indexes of a table that are not a constraint's. */
final class IndexController extends TableChildController
{
    public function sql(NodeContext $ctx, int $oid): string
    {
        $parent = $ctx->conn->row($ctx->renderFrom('indexes', 'get_parent.sql', ['tid' => $ctx->id('tid')])) ?? throw $this->gone($ctx);

        return IndexDdl::sql($ctx, (string) $parent['schema'], (string) $parent['table'], (int) $ctx->id('tid'), $oid);
    }
}
