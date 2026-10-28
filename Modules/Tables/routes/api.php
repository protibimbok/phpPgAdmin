<?php

declare(strict_types=1);

use League\Route\Http\Exception\BadRequestException;
use PhpPgAdmin\Core\Database\ConnectionPool;
use PhpPgAdmin\Core\Facades\Nodes;
use PhpPgAdmin\Core\Facades\Route;
use PhpPgAdmin\Core\Nodes\NodeContext;
use PhpPgAdmin\Core\Nodes\NodeController;
use PhpPgAdmin\Modules\Auth\Http\Middleware\Authenticate;
use PhpPgAdmin\Modules\Tables\Http\Controllers\PartitionController;
use PhpPgAdmin\Modules\Tables\Http\Controllers\StatisticsController;
use PhpPgAdmin\Modules\Tables\Http\Controllers\TableController;
use PhpPgAdmin\Modules\Tables\Http\Controllers\TriggerController;
use Psr\Http\Message\ServerRequestInterface;

// Beyond the node operations: the exact row count of a table, TRUNCATE, the copy of a table and
// the lists the forms offer.
$context = static function (ServerRequestInterface $request, array $args): NodeContext {
    $db = rawurldecode($args['db']);
    if ($db === '') {
        throw new BadRequestException('A database name is required.');
    }
    $pool = ConnectionPool::from($request);
    $ids = ['scid' => (int) $args['scid']];
    if (isset($args['tid'])) {
        $ids['tid'] = (int) $args['tid'];
    }

    return new NodeContext(Nodes::get('table'), Nodes::registry(), $pool, $pool->for($db), $db, $ids, $request);
};

$flag = static fn (array $input, string $key): bool => !empty($input[$key]) && $input[$key] !== 'false' && $input[$key] !== '0';

Route::middleware(Authenticate::class)->group(function () use ($context, $flag): void {
    Route::get('/databases/{db}/schemas/{scid:number}/tables/options', fn (ServerRequestInterface $request, array $args): array => (new TableController())->options($context($request, $args)))->setName('tables.options');

    // ?am=gist&types[]=integer&types[]=tstzrange: the operator classes of the method and the operators per type.
    Route::get('/databases/{db}/schemas/{scid:number}/tables/{tid:number}/exclusion-options', function (ServerRequestInterface $request, array $args) use ($context): array {
        $ctx = $context($request, $args);
        $params = $ctx->queryParams();

        return (new TableController())->exclusionOptions($ctx, trim((string) ($params['am'] ?? '')), array_map(strval(...), (array) ($params['types'] ?? [])));
    })->setName('tables.exclusion_options');

    // The lists the trigger and policy editors offer, for a table's or a view's triggers.
    foreach (['tables/{tid:number}' => 'trigger', 'views/{vid:number}' => 'view_trigger'] as $prefix => $type) {
        Route::get("/databases/{db}/schemas/{scid:number}/{$prefix}/triggers/options", function (ServerRequestInterface $request, array $args) use ($type): array {
            $db = rawurldecode($args['db']);
            $pool = ConnectionPool::from($request);
            $ids = ['scid' => (int) $args['scid']];
            foreach (['tid', 'vid'] as $key) {
                if (isset($args[$key])) {
                    $ids[$key] = (int) $args[$key];
                }
            }

            return (new TriggerController())->options(new NodeContext(Nodes::get($type), Nodes::registry(), $pool, $pool->for($db), $db, $ids, $request));
        })->setName("{$type}.options");
    }

    // Partitions beyond the node operations: the tables that may be attached, and DETACH. The
    // context is the partition node's, so its templates render from the partitions folder.
    $partitionContext = static function (ServerRequestInterface $request, array $args): NodeContext {
        $db = rawurldecode($args['db']);
        $pool = ConnectionPool::from($request);

        return new NodeContext(Nodes::get('partition'), Nodes::registry(), $pool, $pool->for($db), $db, ['scid' => (int) $args['scid'], 'tid' => (int) $args['tid']], $request);
    };

    Route::get('/databases/{db}/schemas/{scid:number}/tables/{tid:number}/partitions/attach-candidates', fn (ServerRequestInterface $request, array $args): array => [
        'tables' => (new PartitionController())->attachCandidates($partitionContext($request, $args)),
    ])->setName('partitions.attach_candidates');

    // {mode: '' | 'concurrently' | 'finalize'}: the statement run comes back.
    Route::post('/databases/{db}/schemas/{scid:number}/tables/{tid:number}/partitions/{ptid:number}/detach', function (ServerRequestInterface $request, array $args) use ($partitionContext): array {
        $ctx = $partitionContext($request, $args);

        return ['ok' => true, 'sql' => (new PartitionController())->detach($ctx, (int) $args['ptid'], (string) ($ctx->input()['mode'] ?? ''))];
    })->setName('partitions.detach');

    // The statistics objects defined on the table, whichever schema holds them.
    Route::get('/databases/{db}/schemas/{scid:number}/tables/{tid:number}/extended-statistics', function (ServerRequestInterface $request, array $args): array {
        $db = rawurldecode($args['db']);
        $pool = ConnectionPool::from($request);
        $ctx = new NodeContext(Nodes::get('statistic'), Nodes::registry(), $pool, $pool->for($db), $db, ['scid' => (int) $args['scid']], $request);

        return ['rows' => (new StatisticsController())->forTable($ctx, (int) $args['tid'])];
    })->setName('tables.extended-statistics');

    Route::get('/databases/{db}/schemas/{scid:number}/tables/{tid:number}/count', fn (ServerRequestInterface $request, array $args): array => [
        'count' => (new TableController())->countRows($context($request, $args), (int) $args['tid']),
    ])->setName('tables.count');

    Route::post('/databases/{db}/schemas/{scid:number}/tables/{tid:number}/truncate', function (ServerRequestInterface $request, array $args) use ($context, $flag): array {
        $ctx = $context($request, $args);
        $input = $ctx->input();

        return ['ok' => true, 'sql' => (new TableController())->truncate($ctx, (int) $args['tid'], $flag($input, 'cascade'), $flag($input, 'identity'))];
    })->setName('tables.truncate');

    // ?preview=1 returns the statements without running them.
    Route::post('/databases/{db}/schemas/{scid:number}/tables/{tid:number}/copy', function (ServerRequestInterface $request, array $args) use ($context): array {
        $ctx = $context($request, $args);
        $controller = new TableController();
        $sql = $controller->copySql($ctx, (int) $args['tid'], $ctx->input());
        if (!$ctx->flag('preview') && NodeController::hasStatements($sql)) {
            $ctx->conn->queryMulti($sql);
        }

        return ['ok' => true, 'sql' => $sql];
    })->setName('tables.copy');
});
