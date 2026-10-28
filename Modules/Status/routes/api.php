<?php

declare(strict_types=1);

use PhpPgAdmin\Core\Facades\Route;
use PhpPgAdmin\Modules\Auth\Http\Middleware\Authenticate;
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

Route::middleware(Authenticate::class)->controller(VariablesController::class)->group(function (): void {
    Route::get('/server/variables', 'index')->setName('variables.index');
    Route::get('/server/variables/{name}', 'show')->setName('variables.show');
    Route::put('/server/variables/{name}', 'update')->setName('variables.update');
});
