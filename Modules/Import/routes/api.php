<?php

declare(strict_types=1);

use PhpPgAdmin\Core\Facades\Route;
use PhpPgAdmin\Modules\Auth\Http\Middleware\Authenticate;
use PhpPgAdmin\Modules\Import\Http\Controllers\ImportController;
use PhpPgAdmin\Modules\Import\Http\Controllers\ProcessController;

// The scope is in the request: no database for the server, then a database and a schema.
Route::middleware(Authenticate::class)->controller(ImportController::class)->group(function (): void {
    Route::get('/import/options', 'options')->setName('import.options');
    Route::post('/import', 'import')->setName('import.run');
});

Route::middleware(Authenticate::class)->controller(ProcessController::class)->group(function (): void {
    Route::get('/processes', 'index')->setName('processes.index');
    Route::get('/processes/{id:[0-9a-f]{24}}', 'show')->setName('processes.show');
    Route::post('/processes/{id:[0-9a-f]{24}}/stop', 'stop')->setName('processes.stop');
    Route::delete('/processes/{id:[0-9a-f]{24}}', 'destroy')->setName('processes.destroy');
});
