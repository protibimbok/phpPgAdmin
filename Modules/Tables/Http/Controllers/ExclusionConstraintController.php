<?php

declare(strict_types=1);

namespace PhpPgAdmin\Modules\Tables\Http\Controllers;

use PhpPgAdmin\Core\Nodes\NodeContext;

/**
 * The exclusion constraint node, after pgAdmin's ExclusionConstraintView. The templates name the
 * constraint's index "exid" in nodes.sql and "cid" in properties.sql; both get the OID.
 */
final class ExclusionConstraintController extends ConstraintController
{
    protected function constraintKind(): string
    {
        return 'exclusion_constraint';
    }

    protected function vars(NodeContext $ctx, ?int $oid = null): array
    {
        $vars = parent::vars($ctx, $oid);
        if ($oid !== null) {
            $vars['cid'] = $oid;
        }

        return $vars;
    }
}
