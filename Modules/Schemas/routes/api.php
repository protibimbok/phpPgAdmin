<?php

declare(strict_types=1);

use League\Route\Http\Exception\BadRequestException;
use PhpPgAdmin\Core\Database\ConnectionPool;
use PhpPgAdmin\Core\Facades\Nodes;
use PhpPgAdmin\Core\Facades\Route;
use PhpPgAdmin\Core\Nodes\NodeContext;
use PhpPgAdmin\Modules\Auth\Http\Middleware\Authenticate;
use PhpPgAdmin\Modules\Schemas\Http\Controllers\DataDictionaryController;
use PhpPgAdmin\Modules\Schemas\Http\Controllers\SchemaController;
use PhpPgAdmin\Modules\Schemas\Http\Controllers\SchemaCopyController;
use Psr\Http\Message\ServerRequestInterface;

// Beyond the node operations: the lists the create and alter forms offer in their selects.
Route::middleware(Authenticate::class)->group(function (): void {
    Route::get('/databases/{db}/schemas/options', function (ServerRequestInterface $request, array $args): array {
        $db = rawurldecode($args['db']);
        if ($db === '') {
            throw new BadRequestException('A database name is required.');
        }
        $pool = ConnectionPool::from($request);
        $ctx = new NodeContext(Nodes::get('schema'), Nodes::registry(), $pool, $pool->for($db), $db, [], $request);

        return (new SchemaController())->options($ctx);
    })->setName('schemas.options');
});

// phpMyAdmin's data dictionary: the database's tables (?schema= for one schema's) with their columns and indexes.
Route::middleware(Authenticate::class)->controller(DataDictionaryController::class)->group(function (): void {
    Route::get('/databases/{db}/data-dictionary', 'show')->setName('schemas.data_dictionary');
});

// phpMyAdmin's Copy database to, for a schema: its objects (and rows) under a new name.
Route::middleware(Authenticate::class)->controller(SchemaCopyController::class)->group(function (): void {
    Route::post('/databases/{db}/schemas/{scid:number}/copy', 'copySchema')->setName('schemas.copy');
});
