<?php

declare(strict_types=1);

use League\Route\Http\Exception\BadRequestException;
use PhpPgAdmin\Core\Database\ConnectionPool;
use PhpPgAdmin\Core\Facades\Nodes;
use PhpPgAdmin\Core\Facades\Route;
use PhpPgAdmin\Core\Nodes\NodeContext;
use PhpPgAdmin\Modules\Auth\Http\Middleware\Authenticate;
use PhpPgAdmin\Modules\Types\Http\Controllers\DomainController;
use PhpPgAdmin\Modules\Types\Http\Controllers\TypeController;
use Psr\Http\Message\ServerRequestInterface;

// Beyond the node operations: the lists the editors offer.
$context = static function (ServerRequestInterface $request, array $args, string $type): NodeContext {
    $db = rawurldecode($args['db']);
    if ($db === '') {
        throw new BadRequestException('A database name is required.');
    }
    $pool = ConnectionPool::from($request);

    return new NodeContext(Nodes::get($type), Nodes::registry(), $pool, $pool->for($db), $db, ['scid' => (int) $args['scid']], $request);
};

Route::middleware(Authenticate::class)->group(function () use ($context): void {
    // ?subtype=int4 also lists the operator classes a range on that subtype may use.
    Route::get('/databases/{db}/schemas/{scid:number}/types/options', function (ServerRequestInterface $request, array $args) use ($context): array {
        $ctx = $context($request, $args, 'type');

        return (new TypeController())->options($ctx, trim((string) ($ctx->queryParams()['subtype'] ?? '')));
    })->setName('types.options');

    Route::get('/databases/{db}/schemas/{scid:number}/domains/options', fn (ServerRequestInterface $request, array $args): array => (new DomainController())->options($context($request, $args, 'domain')))->setName('domains.options');
});
