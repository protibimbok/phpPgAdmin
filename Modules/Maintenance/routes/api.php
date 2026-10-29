<?php

declare(strict_types=1);

use PhpPgAdmin\Core\Facades\Route;
use PhpPgAdmin\Modules\Auth\Http\Middleware\Authenticate;
use PhpPgAdmin\Modules\Maintenance\Http\Controllers\MaintenanceController;

// The target is in the request: a database, and a schema of it.
Route::middleware(Authenticate::class)->controller(MaintenanceController::class)->group(function (): void {
    Route::get('/maintenance/options', 'options')->setName('maintenance.options');
    Route::post('/maintenance', 'run')->setName('maintenance.run');
});
