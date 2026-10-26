<?php

declare(strict_types=1);

use League\Route\Http\Exception\BadRequestException;
use PhpPgAdmin\Core\Database\ConnectionPool;
use PhpPgAdmin\Core\Facades\Nodes;
use PhpPgAdmin\Core\Facades\Route;
use PhpPgAdmin\Core\Nodes\NodeContext;
use PhpPgAdmin\Modules\Auth\Http\Middleware\Authenticate;
use PhpPgAdmin\Modules\Tables\Http\Controllers\TableController;
use Psr\Http\Message\ServerRequestInterface;

// Beyond the node operations: the exact row count of a table, which the structure page asks for on demand.
Route::middleware(Authenticate::class)->group(function (): void {
    Route::get('/databases/{db}/schemas/{scid:number}/tables/{tid:number}/count', function (ServerRequestInterface $request, array $args): array {
        $db = rawurldecode($args['db']);
        if ($db === '') {
            throw new BadRequestException('A database name is required.');
        }
        $pool = ConnectionPool::from($request);
        $node = Nodes::get('table');
        $ctx = new NodeContext($node, Nodes::registry(), $pool, $pool->for($db), $db, ['scid' => (int) $args['scid'], 'tid' => (int) $args['tid']], $request);

        return ['count' => (new TableController())->countRows($ctx, (int) $args['tid'])];
    })->setName('tables.count');
});
