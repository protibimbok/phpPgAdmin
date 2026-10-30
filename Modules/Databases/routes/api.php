<?php

declare(strict_types=1);

use PhpPgAdmin\Core\Database\ConnectionPool;
use PhpPgAdmin\Core\Facades\Nodes;
use PhpPgAdmin\Core\Facades\Route;
use PhpPgAdmin\Core\Nodes\NodeContext;
use PhpPgAdmin\Modules\Auth\Http\Middleware\Authenticate;
use PhpPgAdmin\Modules\Databases\Http\Controllers\AutovacuumTablesController;
use PhpPgAdmin\Modules\Databases\Http\Controllers\DatabaseController;
use PhpPgAdmin\Modules\Databases\Http\Controllers\SecurityLabelController;
use Psr\Http\Message\ServerRequestInterface;

// Beyond the node operations: the lists the create and alter forms offer in their selects.
Route::middleware(Authenticate::class)->group(function (): void {
    Route::get('/server/databases/options', function (ServerRequestInterface $request): array {
        $pool = ConnectionPool::from($request);
        $conn = $pool->maintenance();
        $ctx = new NodeContext(Nodes::get('database'), Nodes::registry(), $pool, $conn, $conn->database(), [], $request);

        return (new DatabaseController())->options($ctx);
    })->setName('databases.options');

    // An object's security labels: ?catalog=pg_class&oid=…&subid=… reads them, POST {catalog, oid,
    // subid, labels} writes the client's list, …/sql previews the statements. A role's (and a
    // database's) are reached from the server too, on the maintenance database.
    foreach (['/databases/{db}/security_labels', '/server/security_labels'] as $path) {
        $connection = static fn (ServerRequestInterface $request, array $args) => isset($args['db']) ? ConnectionPool::from($request)->for(rawurldecode($args['db'])) : ConnectionPool::from($request)->maintenance();
        $target = static function (array $input): array {
            return [(string) ($input['catalog'] ?? ''), (int) ($input['oid'] ?? 0), (int) ($input['subid'] ?? 0)];
        };
        $name = str_starts_with($path, '/server') ? 'server.security_labels' : 'databases.security_labels';
        Route::get($path, function (ServerRequestInterface $request, array $args) use ($connection, $target): array {
            [$catalog, $oid, $subid] = $target($request->getQueryParams());

            return (new SecurityLabelController())->show($connection($request, $args), $catalog, $oid, $subid);
        })->setName($name);
        Route::post($path . '/sql', function (ServerRequestInterface $request, array $args) use ($connection, $target): array {
            $body = (array) ($request->getParsedBody() ?? []);
            [$catalog, $oid, $subid] = $target($body);

            return ['sql' => (new SecurityLabelController())->sql($connection($request, $args), $catalog, $oid, $subid, $body['labels'] ?? [])];
        })->setName($name . '.sql');
        Route::post($path, function (ServerRequestInterface $request, array $args) use ($connection, $target): array {
            $body = (array) ($request->getParsedBody() ?? []);
            [$catalog, $oid, $subid] = $target($body);

            return (new SecurityLabelController())->apply($connection($request, $args), $catalog, $oid, $subid, $body['labels'] ?? []);
        })->setName($name . '.apply');
    }

    // The tables and materialized views with autovacuum settings of their own, and their RESET.
    Route::get('/databases/{db}/autovacuum_tables', fn (ServerRequestInterface $request, array $args): array => ['rows' => (new AutovacuumTablesController())->list(ConnectionPool::from($request)->for(rawurldecode($args['db'])))])->setName('databases.autovacuum_tables');
    Route::post('/databases/{db}/autovacuum_tables/{oid:number}/reset', function (ServerRequestInterface $request, array $args): array {
        (new AutovacuumTablesController())->reset(ConnectionPool::from($request)->for(rawurldecode($args['db'])), (int) $args['oid']);

        return ['ok' => true];
    })->setName('databases.autovacuum_tables.reset');
});
