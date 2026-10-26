<?php

declare(strict_types=1);

namespace PhpPgAdmin\Modules\Sequences;

use PhpPgAdmin\Core\Contracts\Module;
use PhpPgAdmin\Core\Contracts\ProvidesNodes;
use PhpPgAdmin\Core\Contracts\ProvidesSqlTemplates;
use PhpPgAdmin\Core\Nodes\NodeDefinition;
use PhpPgAdmin\Modules\Sequences\Http\Controllers\SequenceController;

/** Sequences: pgAdmin's sequence node. */
final class SequencesModule implements Module, ProvidesNodes, ProvidesSqlTemplates
{
    public function name(): string
    {
        return 'sequences';
    }

    public function path(): string
    {
        return __DIR__;
    }

    public function nodes(): array
    {
        return [
            new NodeDefinition(
                type: 'sequence',
                collection: 'sequences',
                idParam: 'seid',
                controller: SequenceController::class,
                parent: 'schema',
                templateDir: 'sequences',
                label: 'Sequences',
                icon: 'b_plugin',
                supports: ['sql', 'msql', 'stats', 'depends', 'resolve'],
            ),
        ];
    }

    public function sqlTemplatesPath(): string
    {
        return 'resources/sql';
    }
}
