<?php

declare(strict_types=1);

namespace PhpPgAdmin\Modules\Tables\Http\Controllers;

use PhpPgAdmin\Core\Nodes\NodeContext;
use PhpPgAdmin\Modules\Tables\Ddl\Constraints;

/** The foreign key node, after pgAdmin's ForeignKeyConstraintView. */
final class ForeignKeyController extends ConstraintController
{
    protected function constraintKind(): string
    {
        return 'foreign_key';
    }

    /** The foreign keys with their column pairs and referenced table, as the relation view edits them. */
    public function list(NodeContext $ctx): array
    {
        return Constraints::foreignKeys($ctx, (int) $ctx->id('tid'));
    }
}
