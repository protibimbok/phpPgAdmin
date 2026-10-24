<?php

declare(strict_types=1);

use PhpPgAdmin\Core\Facades\Route;
use PhpPgAdmin\Modules\Auth\Http\Middleware\Authenticate;
use PhpPgAdmin\Modules\Server\Http\Controllers\ServerController;

Route::middleware(Authenticate::class)->prefix('server')->controller(ServerController::class)->group(function (): void {
    Route::get('/info', 'info')->setName('server.info');
});
