<?php

declare(strict_types=1);

use PhpPgAdmin\Core\Facades\Route;
use PhpPgAdmin\Modules\Auth\Http\Middleware\Authenticate;
use PhpPgAdmin\Modules\Status\Http\Controllers\LogsController;
use PhpPgAdmin\Modules\Status\Http\Controllers\StatisticsController;
use PhpPgAdmin\Modules\Status\Http\Controllers\StatusController;
use PhpPgAdmin\Modules\Status\Http\Controllers\VariablesController;

Route::middleware(Authenticate::class)->controller(StatusController::class)->group(function (): void {
    Route::get('/server/status', 'server')->setName('status.server');
    Route::get('/server/status/charts', 'charts')->setName('status.charts');
    Route::get('/server/status/activity', 'activity')->setName('status.activity');
    Route::post('/server/status/activity/{pid:number}/cancel', 'cancel')->setName('status.cancel');
    Route::post('/server/status/activity/{pid:number}/terminate', 'terminate')->setName('status.terminate');
    Route::get('/server/status/locks', 'locks')->setName('status.locks');
    Route::get('/server/status/prepared', 'prepared')->setName('status.prepared');
    Route::post('/server/status/prepared/commit', 'commitPrepared')->setName('status.prepared.commit');
    Route::post('/server/status/prepared/rollback', 'rollbackPrepared')->setName('status.prepared.rollback');
});

Route::middleware(Authenticate::class)->controller(StatisticsController::class)->group(function (): void {
    Route::get('/server/status/queries', 'queries')->setName('status.queries');
    Route::post('/server/status/queries/reset', 'resetQueries')->setName('status.queries.reset');
    Route::get('/server/status/counters', 'counters')->setName('status.counters');
    Route::post('/server/status/counters/reset', 'resetShared')->setName('status.counters.reset');
    Route::get('/server/status/io', 'io')->setName('status.io');
    Route::get('/server/status/progress', 'progress')->setName('status.progress');
});

Route::middleware(Authenticate::class)->controller(VariablesController::class)->group(function (): void {
    Route::get('/server/variables', 'index')->setName('variables.index');
    Route::get('/server/variables/{name}', 'show')->setName('variables.show');
    Route::put('/server/variables/{name}', 'update')->setName('variables.update');
});

Route::middleware(Authenticate::class)->controller(LogsController::class)->group(function (): void {
    Route::get('/server/logs', 'index')->setName('logs.index');
    Route::get('/server/logs/{name:[^/]+}', 'show')->setName('logs.show');
    Route::get('/server/logs/{name:[^/]+}/download', 'download')->setName('logs.download');
});
