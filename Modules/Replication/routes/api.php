<?php

declare(strict_types=1);

use League\Route\Http\Exception\BadRequestException;
use PhpPgAdmin\Core\Database\ConnectionPool;
use PhpPgAdmin\Core\Facades\Nodes;
use PhpPgAdmin\Core\Facades\Route;
use PhpPgAdmin\Core\Nodes\NodeContext;
use PhpPgAdmin\Modules\Auth\Http\Middleware\Authenticate;
use PhpPgAdmin\Modules\Replication\Http\Controllers\PublicationController;
use PhpPgAdmin\Modules\Replication\Http\Controllers\ReplicationController;
use PhpPgAdmin\Modules\Replication\Http\Controllers\SubscriptionController;
use Psr\Http\Message\ServerRequestInterface;

Route::middleware(Authenticate::class)->controller(ReplicationController::class)->group(function (): void {
    Route::get('/server/replication', 'index')->setName('replication.index');
    Route::post('/server/replication/slots', 'createSlot')->setName('replication.slots.create');
    Route::delete('/server/replication/slots/{name:[^/]+}', 'dropSlot')->setName('replication.slots.drop');
    Route::post('/server/replication/replay/pause', 'pauseReplay')->setName('replication.replay.pause');
    Route::post('/server/replication/replay/resume', 'resumeReplay')->setName('replication.replay.resume');
    Route::post('/server/replication/restore-point', 'createRestorePoint')->setName('replication.restore_point');
});

// Beyond the node operations: the lists the editors offer, and the publications of the
// publisher a subscription connects to (?subid= fills the form's blanks from that subscription).
$context = static function (ServerRequestInterface $request, array $args, string $type): NodeContext {
    $db = rawurldecode($args['db']);
    if ($db === '') {
        throw new BadRequestException('A database name is required.');
    }
    $pool = ConnectionPool::from($request);

    return new NodeContext(Nodes::get($type), Nodes::registry(), $pool, $pool->for($db), $db, [], $request);
};

Route::middleware(Authenticate::class)->group(function () use ($context): void {
    Route::get('/databases/{db}/publications/options', fn (ServerRequestInterface $request, array $args): array => (new PublicationController())->options($context($request, $args, 'publication')))
        ->setName('publications.options');

    Route::get('/databases/{db}/publications/columns/{tid:number}', fn (ServerRequestInterface $request, array $args): array => ['columns' => (new PublicationController())->columns($context($request, $args, 'publication'), (int) $args['tid'])])
        ->setName('publications.columns');

    Route::get('/databases/{db}/subscriptions/options', fn (ServerRequestInterface $request, array $args): array => (new SubscriptionController())->options($context($request, $args, 'subscription')))
        ->setName('subscriptions.options');

    Route::post('/databases/{db}/subscriptions/publications', function (ServerRequestInterface $request, array $args) use ($context): array {
        $ctx = $context($request, $args, 'subscription');
        $subid = (int) ($ctx->queryParams()['subid'] ?? 0);

        return ['publications' => (new SubscriptionController())->publications($ctx, $subid > 0 ? $subid : null, $ctx->input())];
    })->setName('subscriptions.publications');
});
