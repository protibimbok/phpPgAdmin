<?php

declare(strict_types=1);

use League\Route\Http\Exception\BadRequestException;
use PhpPgAdmin\Core\Database\ConnectionPool;
use PhpPgAdmin\Core\Facades\Nodes;
use PhpPgAdmin\Core\Facades\Route;
use PhpPgAdmin\Core\Nodes\NodeContext;
use PhpPgAdmin\Modules\Auth\Http\Middleware\Authenticate;
use PhpPgAdmin\Modules\DbObjects\Http\Controllers\CastController;
use PhpPgAdmin\Modules\DbObjects\Http\Controllers\EventTriggerController;
use PhpPgAdmin\Modules\DbObjects\Http\Controllers\ExtensionController;
use PhpPgAdmin\Modules\DbObjects\Http\Controllers\ForeignDataWrapperController;
use PhpPgAdmin\Modules\DbObjects\Http\Controllers\ForeignServerController;
use PhpPgAdmin\Modules\DbObjects\Http\Controllers\ForeignTableController;
use PhpPgAdmin\Modules\DbObjects\Http\Controllers\LanguageController;
use PhpPgAdmin\Modules\DbObjects\Http\Controllers\UserMappingController;
use Psr\Http\Message\ServerRequestInterface;

// Beyond the node operations: the lists the editors offer.
$context = static function (ServerRequestInterface $request, array $args, string $type): NodeContext {
    $db = rawurldecode($args['db']);
    if ($db === '') {
        throw new BadRequestException('A database name is required.');
    }
    $pool = ConnectionPool::from($request);

    return new NodeContext(Nodes::get($type), Nodes::registry(), $pool, $pool->for($db), $db, isset($args['scid']) ? ['scid' => (int) $args['scid']] : [], $request);
};

Route::middleware(Authenticate::class)->group(function () use ($context): void {
    Route::get('/databases/{db}/extensions/options', fn (ServerRequestInterface $request, array $args): array => (new ExtensionController())->options($context($request, $args, 'extension')))->setName('extensions.options');
    Route::get('/databases/{db}/languages/options', fn (ServerRequestInterface $request, array $args): array => (new LanguageController())->options($context($request, $args, 'language')))->setName('languages.options');
    // ?srctyp=…&trgtyp=… also lists the functions that can do the conversion.
    Route::get('/databases/{db}/casts/options', function (ServerRequestInterface $request, array $args) use ($context): array {
        $ctx = $context($request, $args, 'cast');
        $query = $ctx->queryParams();

        return (new CastController())->options($ctx, trim((string) ($query['srctyp'] ?? '')), trim((string) ($query['trgtyp'] ?? '')));
    })->setName('casts.options');
    Route::get('/databases/{db}/foreign_data_wrappers/options', fn (ServerRequestInterface $request, array $args): array => (new ForeignDataWrapperController())->options($context($request, $args, 'foreign_data_wrapper')))->setName('foreign_data_wrappers.options');
    Route::get('/databases/{db}/foreign_servers/options', fn (ServerRequestInterface $request, array $args): array => (new ForeignServerController())->options($context($request, $args, 'foreign_server')))->setName('foreign_servers.options');
    Route::get('/databases/{db}/user_mappings/options', fn (ServerRequestInterface $request, array $args): array => (new UserMappingController())->options($context($request, $args, 'user_mapping')))->setName('user_mappings.options');
    Route::get('/databases/{db}/schemas/{scid:number}/foreign_tables/options', fn (ServerRequestInterface $request, array $args): array => (new ForeignTableController())->options($context($request, $args, 'foreign_table')))->setName('foreign_tables.options');
    Route::get('/databases/{db}/event_triggers/options', fn (ServerRequestInterface $request, array $args): array => (new EventTriggerController())->options($context($request, $args, 'event_trigger')))->setName('event_triggers.options');
});
