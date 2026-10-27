<?php

declare(strict_types=1);

use League\Route\Http\Exception\BadRequestException;
use PhpPgAdmin\Core\Database\ConnectionPool;
use PhpPgAdmin\Core\Facades\Nodes;
use PhpPgAdmin\Core\Facades\Route;
use PhpPgAdmin\Core\Nodes\NodeContext;
use PhpPgAdmin\Modules\Auth\Http\Middleware\Authenticate;
use PhpPgAdmin\Modules\Tables\Http\Controllers\ColumnController;
use PhpPgAdmin\Modules\Views\Http\Controllers\MaterializedViewController;
use PhpPgAdmin\Modules\Views\Http\Controllers\ViewController;
use Psr\Http\Message\ServerRequestInterface;

// Beyond the node operations: the lists the forms offer, a view's columns (the column node's
// templates take the relation as "tid", whichever kind it is) and the refresh of a materialized view.
$context = static function (ServerRequestInterface $request, array $args, string $type, array $ids): NodeContext {
    $db = rawurldecode($args['db']);
    if ($db === '') {
        throw new BadRequestException('A database name is required.');
    }
    $pool = ConnectionPool::from($request);

    return new NodeContext(Nodes::get($type), Nodes::registry(), $pool, $pool->for($db), $db, $ids, $request);
};

$flag = static fn (array $input, string $key, bool $default = false): bool => array_key_exists($key, $input) ? !empty($input[$key]) && $input[$key] !== 'false' && $input[$key] !== '0' : $default;

Route::middleware(Authenticate::class)->group(function () use ($context, $flag): void {
    Route::get('/databases/{db}/schemas/{scid:number}/views/options', fn (ServerRequestInterface $request, array $args): array => (new ViewController())->options($context($request, $args, 'view', ['scid' => (int) $args['scid']])))->setName('views.options');

    foreach (['views', 'mviews'] as $collection) {
        Route::get("/databases/{db}/schemas/{scid:number}/{$collection}/{vid:number}/columns", function (ServerRequestInterface $request, array $args) use ($context): array {
            $ctx = $context($request, $args, 'column', ['scid' => (int) $args['scid'], 'tid' => (int) $args['vid']]);

            return ['rows' => (new ColumnController())->list($ctx)];
        })->setName("{$collection}.columns");
    }

    // {concurrent, with_data}: REFRESH MATERIALIZED VIEW; the statement run comes back.
    Route::post('/databases/{db}/schemas/{scid:number}/mviews/{vid:number}/refresh', function (ServerRequestInterface $request, array $args) use ($context, $flag): array {
        $ctx = $context($request, $args, 'mview', ['scid' => (int) $args['scid'], 'vid' => (int) $args['vid']]);
        $input = $ctx->input();

        return ['ok' => true, 'sql' => (new MaterializedViewController())->refresh($ctx, (int) $args['vid'], $flag($input, 'concurrent'), $flag($input, 'with_data', true))];
    })->setName('mviews.refresh');
});
