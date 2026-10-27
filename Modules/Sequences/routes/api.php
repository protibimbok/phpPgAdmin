<?php

declare(strict_types=1);

use League\Route\Http\Exception\BadRequestException;
use PhpPgAdmin\Core\Database\ConnectionPool;
use PhpPgAdmin\Core\Facades\Nodes;
use PhpPgAdmin\Core\Facades\Route;
use PhpPgAdmin\Core\Nodes\NodeContext;
use PhpPgAdmin\Modules\Auth\Http\Middleware\Authenticate;
use PhpPgAdmin\Modules\Sequences\Http\Controllers\SequenceController;
use Psr\Http\Message\ServerRequestInterface;

// Beyond the node operations: the lists the editor offers.
Route::middleware(Authenticate::class)->group(function (): void {
    Route::get('/databases/{db}/schemas/{scid:number}/sequences/options', function (ServerRequestInterface $request, array $args): array {
        $db = rawurldecode($args['db']);
        if ($db === '') {
            throw new BadRequestException('A database name is required.');
        }
        $pool = ConnectionPool::from($request);
        $ctx = new NodeContext(Nodes::get('sequence'), Nodes::registry(), $pool, $pool->for($db), $db, ['scid' => (int) $args['scid']], $request);

        return (new SequenceController())->options($ctx);
    })->setName('sequences.options');
});
