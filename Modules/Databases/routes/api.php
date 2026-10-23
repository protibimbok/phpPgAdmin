<?php

declare(strict_types=1);

use PhpPgAdmin\Core\Facades\Route;
use PhpPgAdmin\Modules\Auth\Http\Middleware\Authenticate;
use PhpPgAdmin\Modules\Databases\Http\Controllers\DatabaseController;

Route::middleware(Authenticate::class)->controller(DatabaseController::class)->group(function (): void {
    Route::get('/databases', 'index')->setName('databases.index');
});
