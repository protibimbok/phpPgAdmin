<?php

declare(strict_types=1);

namespace PhpPgAdmin\Modules\Tables\Http\Controllers;

use PhpPgAdmin\Core\Nodes\NodeContext;

/**
 * Primary keys and unique constraints, after pgAdmin's IndexConstraintView: one template set,
 * told apart by the constraint type.
 */
abstract class IndexConstraintController extends TableChildController
{
    /** 'p' for a primary key, 'u' for a unique constraint. */
    abstract protected function constraintType(): string;

    protected function vars(NodeContext $ctx, ?int $oid = null): array
    {
        return [...parent::vars($ctx, $oid), 'constraint_type' => $this->constraintType()];
    }
}
