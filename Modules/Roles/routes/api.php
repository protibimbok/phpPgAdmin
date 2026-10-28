<?php

declare(strict_types=1);

use League\Route\Http\Exception\BadRequestException;
use PhpPgAdmin\Core\Database\Connection;
use PhpPgAdmin\Core\Database\ConnectionPool;
use PhpPgAdmin\Core\Facades\Nodes;
use PhpPgAdmin\Core\Facades\Route;
use PhpPgAdmin\Core\Nodes\NodeContext;
use PhpPgAdmin\Modules\Auth\Http\Middleware\Authenticate;
use PhpPgAdmin\Modules\Roles\Http\Controllers\PrivilegeController;
use PhpPgAdmin\Modules\Roles\Http\Controllers\RoleController;
use PhpPgAdmin\Modules\Roles\Http\Controllers\TablespaceController;
use Psr\Http\Message\ServerRequestInterface;

// Beyond the node operations: the editors' lists, REASSIGN OWNED / DROP OWNED and a tablespace's
// "Move objects" (preview and run), and the privileges on a tablespace.
Route::middleware(Authenticate::class)->group(function (): void {
    $context = static function (ServerRequestInterface $request, array $ids = [], string $type = 'role'): NodeContext {
        $pool = ConnectionPool::from($request);
        $conn = $pool->maintenance();

        return new NodeContext(Nodes::get($type), Nodes::registry(), $pool, $conn, $conn->database(), $ids, $request);
    };

    Route::get('/server/roles/options', fn (ServerRequestInterface $request): array => (new RoleController())->options($context($request)))
        ->setName('roles.options');

    foreach (['reassign' => true, 'reassign/sql' => false] as $path => $run) {
        Route::post('/server/roles/{rid:number}/' . $path, function (ServerRequestInterface $request, array $args) use ($context, $run): array {
            $ctx = $context($request, ['rid' => (int) $args['rid']]);

            return ['sql' => (new RoleController())->reassign($ctx, (int) $args['rid'], $ctx->input(), $run)];
        })->setName($run ? 'roles.reassign' : 'roles.reassign.sql');
    }

    Route::get('/server/roles/{rid:number}/databases', fn (ServerRequestInterface $request, array $args): array => ['databases' => (new PrivilegeController())->databasesOf(ConnectionPool::from($request)->maintenance(), (int) $args['rid'])])
        ->setName('roles.databases');

    Route::get('/server/tablespaces/options', fn (ServerRequestInterface $request): array => (new TablespaceController())->options($context($request, [], 'tablespace')))
        ->setName('tablespaces.options');

    foreach (['move' => true, 'move/sql' => false] as $path => $run) {
        Route::post('/server/tablespaces/{tsid:number}/' . $path, function (ServerRequestInterface $request, array $args) use ($context, $run): array {
            $ctx = $context($request, ['tsid' => (int) $args['tsid']], 'tablespace');

            return ['sql' => (new TablespaceController())->move($ctx, (int) $args['tsid'], $ctx->input(), $run)];
        })->setName($run ? 'tablespaces.move' : 'tablespaces.move.sql');
    }

    // pg_tablespace is shared, so its privileges are read and set through the maintenance connection.
    $privileges = new PrivilegeController();
    $maintenance = static fn (ServerRequestInterface $request): Connection => ConnectionPool::from($request)->maintenance();
    $body = static fn (ServerRequestInterface $request): array => (array) ($request->getParsedBody() ?? []);
    Route::get('/server/privileges/tablespace/{oid:number}', fn (ServerRequestInterface $request, array $args): array => $privileges->show($maintenance($request), 'tablespace', (int) $args['oid']))
        ->setName('privileges.tablespace.show');
    Route::post('/server/privileges/tablespace/{oid:number}/msql', fn (ServerRequestInterface $request, array $args): array => ['sql' => $privileges->sql($maintenance($request), 'tablespace', (int) $args['oid'], $body($request))])
        ->setName('privileges.tablespace.msql');
    Route::post('/server/privileges/tablespace/{oid:number}', function (ServerRequestInterface $request, array $args) use ($maintenance, $body, $privileges): array {
        $connection = $maintenance($request);
        $privileges->run($connection, $privileges->sql($connection, 'tablespace', (int) $args['oid'], $body($request)));

        return $privileges->show($connection, 'tablespace', (int) $args['oid']);
    })->setName('privileges.tablespace.update');
});

// Privileges: on one object and its columns, the default privileges, and the grant wizard. Each
// POST runs what its /msql twin previews and answers with the state that results.
Route::middleware(Authenticate::class)->prefix('databases/{db}')->group(function (): void {
    $conn = static function (ServerRequestInterface $request, array $args): Connection {
        $db = rawurldecode($args['db']);

        return $db !== '' ? ConnectionPool::from($request)->for($db) : throw new BadRequestException('A database name is required.');
    };
    $body = static fn (ServerRequestInterface $request): array => (array) ($request->getParsedBody() ?? []);
    $scid = static fn (array $values): ?int => isset($values['scid']) && $values['scid'] !== '' ? (int) $values['scid'] : null;
    $privileges = new PrivilegeController();

    Route::get('/privileges/{kind}/{oid:number}', fn (ServerRequestInterface $request, array $args): array => $privileges->show($conn($request, $args), $args['kind'], (int) $args['oid']))
        ->setName('privileges.show');
    Route::post('/privileges/{kind}/{oid:number}/msql', fn (ServerRequestInterface $request, array $args): array => ['sql' => $privileges->sql($conn($request, $args), $args['kind'], (int) $args['oid'], $body($request))])
        ->setName('privileges.msql');
    Route::post('/privileges/{kind}/{oid:number}', function (ServerRequestInterface $request, array $args) use ($conn, $body, $privileges): array {
        $connection = $conn($request, $args);
        $privileges->run($connection, $privileges->sql($connection, $args['kind'], (int) $args['oid'], $body($request)));

        return $privileges->show($connection, $args['kind'], (int) $args['oid']);
    })->setName('privileges.update');

    Route::get('/default-privileges', fn (ServerRequestInterface $request, array $args): array => $privileges->defaults($conn($request, $args), $scid($request->getQueryParams())))
        ->setName('privileges.defaults');
    Route::post('/default-privileges/msql', fn (ServerRequestInterface $request, array $args): array => ['sql' => $privileges->defaultsSql($conn($request, $args), $scid($body($request)), $body($request))])
        ->setName('privileges.defaults.msql');
    Route::post('/default-privileges', function (ServerRequestInterface $request, array $args) use ($conn, $body, $scid, $privileges): array {
        $connection = $conn($request, $args);
        $privileges->run($connection, $privileges->defaultsSql($connection, $scid($body($request)), $body($request)));

        return $privileges->defaults($connection, $scid($body($request)));
    })->setName('privileges.defaults.update');

    Route::get('/schemas/{scid:number}/grant-wizard', fn (ServerRequestInterface $request, array $args): array => ['objects' => $privileges->wizardObjects($conn($request, $args), (int) $args['scid'])])
        ->setName('privileges.wizard');
    Route::post('/schemas/{scid:number}/grant-wizard/msql', fn (ServerRequestInterface $request, array $args): array => ['sql' => $privileges->wizardSql($conn($request, $args), $body($request))])
        ->setName('privileges.wizard.msql');
    Route::post('/schemas/{scid:number}/grant-wizard', function (ServerRequestInterface $request, array $args) use ($conn, $body, $privileges): array {
        $connection = $conn($request, $args);
        $sql = $privileges->wizardSql($connection, $body($request));
        $privileges->run($connection, $sql);

        return ['sql' => $sql];
    })->setName('privileges.wizard.run');
});
