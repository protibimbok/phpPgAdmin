<?php

declare(strict_types=1);

use PhpPgAdmin\Core\Facades\Route;
use PhpPgAdmin\Modules\Auth\Http\Controllers\AuthController;
use PhpPgAdmin\Modules\Auth\Http\Middleware\Authenticate;

Route::prefix('auth')->controller(AuthController::class)->group(function (): void {
    Route::post('/login', 'login')->setName('auth.login');

    Route::middleware(Authenticate::class)->group(function (): void {
        Route::post('/logout', 'logout')->setName('auth.logout');
        Route::get('/me', 'me')->setName('auth.me');
    });
});
