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

// Beyond the node operations: the lists the editor offers, and the classic phpPgAdmin's
// Restart and Next value actions.
$context = static function (ServerRequestInterface $request, array $args): NodeContext {
    $db = rawurldecode($args['db']);
    if ($db === '') {
        throw new BadRequestException('A database name is required.');
    }
    $pool = ConnectionPool::from($request);

    return new NodeContext(Nodes::get('sequence'), Nodes::registry(), $pool, $pool->for($db), $db, ['scid' => (int) $args['scid']], $request);
};

Route::middleware(Authenticate::class)->group(function () use ($context): void {
    Route::get('/databases/{db}/schemas/{scid:number}/sequences/options', fn (ServerRequestInterface $request, array $args): array => (new SequenceController())->options($context($request, $args)))->setName('sequences.options');

    Route::post('/databases/{db}/schemas/{scid:number}/sequences/{seid:number}/restart', function (ServerRequestInterface $request, array $args) use ($context): array {
        $value = ((array) ($request->getParsedBody() ?? []))['value'] ?? null;
        (new SequenceController())->restart($context($request, $args), (int) $args['seid'], $value === null || $value === '' ? null : trim((string) $value));

        return ['ok' => true];
    })->setName('sequences.restart');

    Route::post('/databases/{db}/schemas/{scid:number}/sequences/{seid:number}/nextval', fn (ServerRequestInterface $request, array $args): array => [
        'value' => (new SequenceController())->nextValue($context($request, $args), (int) $args['seid']),
    ])->setName('sequences.nextval');
});
