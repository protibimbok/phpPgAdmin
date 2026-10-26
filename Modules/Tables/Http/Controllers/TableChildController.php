<?php

declare(strict_types=1);

namespace PhpPgAdmin\Modules\Tables\Http\Controllers;

use PhpPgAdmin\Core\Nodes\NodeContext;
use PhpPgAdmin\Core\Nodes\NodeController;
use PhpPgAdmin\Modules\Databases\Http\Controllers\DatabaseController;

/**
 * Shared ground for what hangs under a table (columns, indexes, constraints…): pgAdmin's
 * templates take the table as "tid", the object under the node's id parameter, and a flag for
 * system objects.
 */
abstract class TableChildController extends NodeController
{
    /** @return array<string, mixed> */
    protected function vars(NodeContext $ctx, ?int $oid = null): array
    {
        $vars = ['show_sys_objects' => $ctx->flag('system_objects'), 'datlastsysoid' => DatabaseController::LAST_SYSTEM_OID];
        if ($oid !== null) {
            $vars[$ctx->node->idParam] = $oid;
        }

        return $vars;
    }

    public function list(NodeContext $ctx): array
    {
        return $ctx->rows('properties.sql', $this->vars($ctx));
    }

    public function nodes(NodeContext $ctx): array
    {
        return array_map(fn (array $row): array => $this->toNode($ctx, $row), $ctx->rows('nodes.sql', $this->vars($ctx)));
    }

    public function node(NodeContext $ctx, int $oid): array
    {
        $row = $ctx->row('nodes.sql', $this->vars($ctx, $oid)) ?? throw $this->gone($ctx);

        return $this->toNode($ctx, $row);
    }

    public function properties(NodeContext $ctx, int $oid): array
    {
        return $ctx->row('properties.sql', $this->vars($ctx, $oid)) ?? throw $this->gone($ctx);
    }
}
