<?php

declare(strict_types=1);

use League\Route\Http\Exception\BadRequestException;
use PhpPgAdmin\Core\Database\ConnectionPool;
use PhpPgAdmin\Core\Facades\Nodes;
use PhpPgAdmin\Core\Facades\Route;
use PhpPgAdmin\Core\Nodes\NodeContext;
use PhpPgAdmin\Modules\Auth\Http\Middleware\Authenticate;
use PhpPgAdmin\Modules\Routines\Http\Controllers\FunctionController;
use PhpPgAdmin\Modules\Routines\Http\Controllers\ProcedureController;
use PhpPgAdmin\Modules\Routines\Http\Controllers\TriggerFunctionController;
use Psr\Http\Message\ServerRequestInterface;

// Beyond the node operations: the lists the editor offers and the call script of a routine.
$context = static function (ServerRequestInterface $request, array $args, string $type): NodeContext {
    $db = rawurldecode($args['db']);
    if ($db === '') {
        throw new BadRequestException('A database name is required.');
    }
    $pool = ConnectionPool::from($request);
    $ids = ['scid' => (int) $args['scid']];
    if (isset($args['fnid'])) {
        $ids['fnid'] = (int) $args['fnid'];
    }

    return new NodeContext(Nodes::get($type), Nodes::registry(), $pool, $pool->for($db), $db, $ids, $request);
};

Route::middleware(Authenticate::class)->group(function () use ($context): void {
    Route::get('/databases/{db}/schemas/{scid:number}/functions/options', fn (ServerRequestInterface $request, array $args): array => (new FunctionController())->options($context($request, $args, 'function')))->setName('routines.options');

    foreach (['functions' => ['function', FunctionController::class], 'procedures' => ['procedure', ProcedureController::class], 'trigger-functions' => ['trigger_function', TriggerFunctionController::class]] as $collection => [$type, $controller]) {
        Route::get("/databases/{db}/schemas/{scid:number}/{$collection}/{fnid:number}/call-sql", fn (ServerRequestInterface $request, array $args): array => [
            'sql' => (new $controller())->callSql($context($request, $args, $type), (int) $args['fnid']),
        ])->setName("{$collection}.call_sql");
    }
});
