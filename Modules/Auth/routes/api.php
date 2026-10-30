<?php

declare(strict_types=1);

use PhpPgAdmin\Core\Facades\Route;
use PhpPgAdmin\Modules\Auth\Http\Controllers\AccountController;
use PhpPgAdmin\Modules\Auth\Http\Controllers\AuthController;
use PhpPgAdmin\Modules\Auth\Http\Controllers\PreferenceController;
use PhpPgAdmin\Modules\Auth\Http\Controllers\RecentFavoriteController;
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
    Route::get('/{id:number}/options', 'options')->setName('auth.servers.options');
    Route::put('/{id:number}/options', 'updateOptions')->setName('auth.servers.options.update');
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

// The navigation panel's Recent and Favorites lists, the role's on this server.
Route::middleware(Authenticate::class)->prefix('navigation/tables')->controller(RecentFavoriteController::class)->group(function (): void {
    Route::get('', 'index')->setName('navigation.tables');
    Route::post('/recent', 'recent')->setName('navigation.tables.recent');
    Route::post('/favorite', 'addFavorite')->setName('navigation.tables.favorite');
    Route::delete('/favorite', 'removeFavorite')->setName('navigation.tables.unfavorite');
});
