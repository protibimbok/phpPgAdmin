<?php

declare(strict_types=1);

namespace PhpPgAdmin\Modules\Types;

use PhpPgAdmin\Core\Contracts\Module;
use PhpPgAdmin\Core\Contracts\ProvidesApiRoutes;
use PhpPgAdmin\Core\Contracts\ProvidesFrontendScripts;
use PhpPgAdmin\Core\Contracts\ProvidesNodes;
use PhpPgAdmin\Core\Contracts\ProvidesSqlTemplates;
use PhpPgAdmin\Core\Contracts\ProvidesTranslations;
use PhpPgAdmin\Core\Contracts\ProvidesViteEntries;
use PhpPgAdmin\Core\Nodes\NodeDefinition;
use PhpPgAdmin\Modules\Types\Http\Controllers\CollationController;
use PhpPgAdmin\Modules\Types\Http\Controllers\DomainController;
use PhpPgAdmin\Modules\Types\Http\Controllers\FtsConfigurationController;
use PhpPgAdmin\Modules\Types\Http\Controllers\FtsDictionaryController;
use PhpPgAdmin\Modules\Types\Http\Controllers\FtsParserController;
use PhpPgAdmin\Modules\Types\Http\Controllers\FtsTemplateController;
use PhpPgAdmin\Modules\Types\Http\Controllers\TypeController;

/** Types: pgAdmin's type, domain, collation and full text search nodes, and the schema's Types page (list, editor and dialogs). */
final class TypesModule implements Module, ProvidesNodes, ProvidesApiRoutes, ProvidesSqlTemplates, ProvidesTranslations, ProvidesViteEntries, ProvidesFrontendScripts
{
    public function name(): string
    {
        return 'types';
    }

    public function path(): string
    {
        return __DIR__;
    }

    public function nodes(): array
    {
        return [
            // phpMyAdmin has no type icon; its plugin (puzzle piece) icon stands for user-defined types.
            new NodeDefinition('type', 'types', 'tid', TypeController::class, parent: 'schema', templateDir: 'types', label: 'Types', icon: 'b_plugin', supports: ['sql', 'msql', 'depends', 'resolve']),
            new NodeDefinition('domain', 'domains', 'doid', DomainController::class, parent: 'schema', templateDir: 'domains', label: 'Domains', icon: 'b_plugin', supports: ['sql', 'msql', 'depends', 'resolve']),
            // phpMyAdmin's language icon for collations, its full text and partial text icons for the text search objects.
            new NodeDefinition('collation', 'collations', 'coid', CollationController::class, parent: 'schema', templateDir: 'collations', label: 'Collations', icon: 's_lang', supports: ['sql', 'msql', 'depends', 'resolve']),
            new NodeDefinition('fts_configuration', 'fts_configurations', 'cfgid', FtsConfigurationController::class, parent: 'schema', templateDir: 'fts_configurations', label: 'FTS Configurations', icon: 's_fulltext', supports: ['sql', 'msql', 'depends', 'resolve']),
            new NodeDefinition('fts_dictionary', 'fts_dictionaries', 'dcid', FtsDictionaryController::class, parent: 'schema', templateDir: 'fts_dictionaries', label: 'FTS Dictionaries', icon: 'b_docs', supports: ['sql', 'msql', 'depends', 'resolve']),
            new NodeDefinition('fts_parser', 'fts_parsers', 'pid', FtsParserController::class, parent: 'schema', templateDir: 'fts_parsers', label: 'FTS Parsers', icon: 's_partialtext', supports: ['sql', 'msql', 'depends', 'resolve']),
            new NodeDefinition('fts_template', 'fts_templates', 'tid', FtsTemplateController::class, parent: 'schema', templateDir: 'fts_templates', label: 'FTS Templates', icon: 'b_plugin', supports: ['sql', 'msql', 'depends', 'resolve']),
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
