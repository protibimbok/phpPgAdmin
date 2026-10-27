<?php

declare(strict_types=1);

namespace PhpPgAdmin\Modules\Sequences;

use PhpPgAdmin\Core\Contracts\Module;
use PhpPgAdmin\Core\Contracts\ProvidesApiRoutes;
use PhpPgAdmin\Core\Contracts\ProvidesFrontendScripts;
use PhpPgAdmin\Core\Contracts\ProvidesNodes;
use PhpPgAdmin\Core\Contracts\ProvidesSqlTemplates;
use PhpPgAdmin\Core\Contracts\ProvidesTranslations;
use PhpPgAdmin\Core\Contracts\ProvidesViteEntries;
use PhpPgAdmin\Core\Nodes\NodeDefinition;
use PhpPgAdmin\Modules\Sequences\Http\Controllers\SequenceController;

/** Sequences: pgAdmin's sequence node, and the schema's Sequences page (list and editor). */
final class SequencesModule implements Module, ProvidesNodes, ProvidesApiRoutes, ProvidesSqlTemplates, ProvidesTranslations, ProvidesViteEntries, ProvidesFrontendScripts
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
                // phpMyAdmin has no sequence icon; its Events one (a scheduled counter) stands in.
                icon: 'b_events',
                supports: ['sql', 'msql', 'stats', 'depends', 'resolve'],
            ),
        ];
    }

    public function apiRoutes(): void
    {
        require __DIR__ . '/routes/api.php';
    }

    public function sqlTemplatesPath(): string
    {
        return 'resources/sql';
    }

    public function translationsPath(): string
    {
        return 'resources/lang';
    }

    public function viteEntries(): array
    {
        return ['resources/js/app.tsx'];
    }

    public function frontendScripts(): array
    {
        return ['resources/js/app.tsx'];
    }
}
