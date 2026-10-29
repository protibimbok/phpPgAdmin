<?php

declare(strict_types=1);

namespace PhpPgAdmin\Modules\DbObjects;

use PhpPgAdmin\Core\Contracts\Module;
use PhpPgAdmin\Core\Contracts\ProvidesApiRoutes;
use PhpPgAdmin\Core\Contracts\ProvidesFrontendScripts;
use PhpPgAdmin\Core\Contracts\ProvidesNodes;
use PhpPgAdmin\Core\Contracts\ProvidesSqlTemplates;
use PhpPgAdmin\Core\Contracts\ProvidesTranslations;
use PhpPgAdmin\Core\Contracts\ProvidesViteEntries;
use PhpPgAdmin\Core\Nodes\NodeDefinition;
use PhpPgAdmin\Modules\DbObjects\Http\Controllers\CastController;
use PhpPgAdmin\Modules\DbObjects\Http\Controllers\EventTriggerController;
use PhpPgAdmin\Modules\DbObjects\Http\Controllers\ExtensionController;
use PhpPgAdmin\Modules\DbObjects\Http\Controllers\ForeignDataWrapperController;
use PhpPgAdmin\Modules\DbObjects\Http\Controllers\ForeignServerController;
use PhpPgAdmin\Modules\DbObjects\Http\Controllers\ForeignTableController;
use PhpPgAdmin\Modules\DbObjects\Http\Controllers\LanguageController;
use PhpPgAdmin\Modules\DbObjects\Http\Controllers\UserMappingController;

/**
 * The objects of a database that belong to no schema, after pgAdmin's nodes of the same names:
 * extensions, procedural languages, casts, event triggers, and the foreign data wrappers with
 * their servers and the servers' user mappings, on the database's Objects page and in the
 * navigation panel under the database; and a schema's foreign tables, on the schema's Foreign
 * tables page.
 */
final class DbObjectsModule implements Module, ProvidesNodes, ProvidesApiRoutes, ProvidesSqlTemplates, ProvidesTranslations, ProvidesViteEntries, ProvidesFrontendScripts
{
    public function name(): string
    {
        return 'dbobjects';
    }

    public function path(): string
    {
        return __DIR__;
    }

    public function nodes(): array
    {
        return [
            new NodeDefinition('extension', 'extensions', 'eid', ExtensionController::class, parent: NodeDefinition::DATABASE, templateDir: 'extensions', label: 'Extensions', icon: 'b_plugin', supports: ['sql', 'msql', 'depends']),
            new NodeDefinition('language', 'languages', 'lid', LanguageController::class, parent: NodeDefinition::DATABASE, templateDir: 'languages', label: 'Languages', icon: 'b_routines', supports: ['sql', 'msql', 'depends']),
            new NodeDefinition('cast', 'casts', 'cid', CastController::class, parent: NodeDefinition::DATABASE, templateDir: 'casts', label: 'Casts', icon: 'b_relations', supports: ['sql', 'msql', 'depends']),
            new NodeDefinition('foreign_data_wrapper', 'foreign_data_wrappers', 'fid', ForeignDataWrapperController::class, parent: NodeDefinition::DATABASE, templateDir: 'foreign_data_wrappers', label: 'Foreign Data Wrappers', icon: 'b_engine', supports: ['sql', 'msql', 'depends', 'children']),
            new NodeDefinition('foreign_server', 'foreign_servers', 'fsid', ForeignServerController::class, parent: 'foreign_data_wrapper', templateDir: 'foreign_servers', label: 'Foreign Servers', icon: 's_host', supports: ['sql', 'msql', 'depends', 'children']),
            new NodeDefinition('user_mapping', 'user_mappings', 'umid', UserMappingController::class, parent: 'foreign_server', templateDir: 'user_mappings', label: 'User Mappings', icon: 'user', supports: ['sql', 'msql', 'depends']),
            new NodeDefinition('foreign_table', 'foreign_tables', 'foid', ForeignTableController::class, parent: 'schema', templateDir: 'foreign_tables', label: 'Foreign Tables', icon: 's_link', supports: ['sql', 'msql', 'depends']),
            new NodeDefinition('event_trigger', 'event_triggers', 'etid', EventTriggerController::class, parent: NodeDefinition::DATABASE, templateDir: 'event_triggers', label: 'Event Triggers', icon: 'b_triggers', supports: ['sql', 'msql', 'depends']),
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
