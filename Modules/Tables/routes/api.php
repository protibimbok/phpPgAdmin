<?php

declare(strict_types=1);

use League\Route\Http\Exception\BadRequestException;
use PhpPgAdmin\Core\Database\ConnectionPool;
use PhpPgAdmin\Core\Facades\Nodes;
use PhpPgAdmin\Core\Facades\Route;
use PhpPgAdmin\Core\Nodes\NodeContext;
use PhpPgAdmin\Core\Nodes\NodeController;
use PhpPgAdmin\Modules\Auth\Http\Middleware\Authenticate;
use PhpPgAdmin\Modules\Tables\Http\Controllers\TableController;
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
