<?php

declare(strict_types=1);

use PhpPgAdmin\Core\Facades\Route;
use PhpPgAdmin\Modules\Auth\Http\Controllers\AccountController;
use PhpPgAdmin\Modules\Auth\Http\Controllers\AuthController;
use PhpPgAdmin\Modules\Auth\Http\Controllers\PreferenceController;
use PhpPgAdmin\Modules\Auth\Http\Controllers\ServerListController;
use PhpPgAdmin\Modules\Auth\Http\Middleware\Authenticate;

Route::prefix('auth')->controller(AuthController::class)->group(function (): void {
    Route::get('/servers', 'servers')->setName('auth.servers');
    Route::post('/login', 'login')->setName('auth.login');

    Route::middleware(Authenticate::class)->group(function (): void {
        Route::post('/logout', 'logout')->setName('auth.logout');
        Route::get('/me', 'me')->setName('auth.me');
    });
});

// Managing the saved servers needs a signed-in user; the login page only lists them.
Route::middleware(Authenticate::class)->prefix('auth/servers')->controller(ServerListController::class)->group(function (): void {
    Route::get('/export', 'exportList')->setName('auth.servers.export');
    Route::post('/import', 'importList')->setName('auth.servers.import');
    Route::patch('/{id:number}', 'update')->setName('auth.servers.rename');
    Route::delete('/{id:number}', 'destroy')->setName('auth.servers.remove');
});

Route::middleware(Authenticate::class)->controller(PreferenceController::class)->group(function (): void {
    Route::get('/preferences', 'index')->setName('preferences.index');
    Route::patch('/preferences', 'update')->setName('preferences.update');
});

Route::middleware(Authenticate::class)->controller(AccountController::class)->group(function (): void {
    Route::get('/account', 'show')->setName('account.show');
    Route::post('/account/password', 'password')->setName('account.password');
});
