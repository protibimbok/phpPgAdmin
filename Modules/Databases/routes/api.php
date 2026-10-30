<?php

declare(strict_types=1);

use PhpPgAdmin\Core\Database\ConnectionPool;
use PhpPgAdmin\Core\Facades\Nodes;
use PhpPgAdmin\Core\Facades\Route;
use PhpPgAdmin\Core\Nodes\NodeContext;
use PhpPgAdmin\Modules\Auth\Http\Middleware\Authenticate;
use PhpPgAdmin\Modules\Databases\Http\Controllers\AutovacuumTablesController;
use PhpPgAdmin\Modules\Databases\Http\Controllers\DatabaseController;
use Psr\Http\Message\ServerRequestInterface;

// Beyond the node operations: the lists the create and alter forms offer in their selects.
Route::middleware(Authenticate::class)->group(function (): void {
    Route::get('/server/databases/options', function (ServerRequestInterface $request): array {
        $pool = ConnectionPool::from($request);
        $conn = $pool->maintenance();
        $ctx = new NodeContext(Nodes::get('database'), Nodes::registry(), $pool, $conn, $conn->database(), [], $request);

        return (new DatabaseController())->options($ctx);
    })->setName('databases.options');

    // The tables and materialized views with autovacuum settings of their own, and their RESET.
    Route::get('/databases/{db}/autovacuum_tables', fn (ServerRequestInterface $request, array $args): array => ['rows' => (new AutovacuumTablesController())->list(ConnectionPool::from($request)->for(rawurldecode($args['db'])))])->setName('databases.autovacuum_tables');
    Route::post('/databases/{db}/autovacuum_tables/{oid:number}/reset', function (ServerRequestInterface $request, array $args): array {
        (new AutovacuumTablesController())->reset(ConnectionPool::from($request)->for(rawurldecode($args['db'])), (int) $args['oid']);

        return ['ok' => true];
    })->setName('databases.autovacuum_tables.reset');
});
