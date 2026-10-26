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

    /** DROP MATERIALIZED VIEW, CASCADE on request. */
    public function delete(NodeContext $ctx, int $oid, bool $cascade): void
    {
        $row = $this->properties($ctx, $oid);
        $this->execute($ctx, $ctx->render('delete.sql', ['vid' => null, 'name' => $row['name'], 'nspname' => $row['schema'], 'cascade' => $cascade]));
    }

    protected function icon(NodeContext $ctx, array $row): string
    {
        return 'b_views';
    }
}
