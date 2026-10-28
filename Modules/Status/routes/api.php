<?php

declare(strict_types=1);

use PhpPgAdmin\Core\Facades\Route;
use PhpPgAdmin\Modules\Auth\Http\Middleware\Authenticate;
use PhpPgAdmin\Modules\Status\Http\Controllers\StatusController;

Route::middleware(Authenticate::class)->controller(StatusController::class)->group(function (): void {
    Route::get('/server/status', 'server')->setName('status.server');
    Route::get('/server/status/charts', 'charts')->setName('status.charts');
    Route::get('/server/status/activity', 'activity')->setName('status.activity');
    Route::post('/server/status/activity/{pid:number}/cancel', 'cancel')->setName('status.cancel');
    Route::post('/server/status/activity/{pid:number}/terminate', 'terminate')->setName('status.terminate');
});
