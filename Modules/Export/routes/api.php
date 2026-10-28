<?php

declare(strict_types=1);

use PhpPgAdmin\Core\Facades\Route;
use PhpPgAdmin\Modules\Auth\Http\Middleware\Authenticate;
use PhpPgAdmin\Modules\Export\Http\Controllers\ExportController;
use PhpPgAdmin\Modules\Export\Http\Controllers\TemplateController;

// The scope is in the request: no database for the server, then a database, a schema and a
// relation, each narrowing the one before.
Route::middleware(Authenticate::class)->controller(ExportController::class)->group(function (): void {
    Route::get('/export/options', 'options')->setName('export.options');
    Route::post('/export', 'export')->setName('export.run');
});

Route::middleware(Authenticate::class)->prefix('export')->controller(TemplateController::class)->group(function (): void {
    Route::get('/templates', 'index')->setName('export.templates');
    Route::post('/templates', 'store')->setName('export.templates.store');
    Route::put('/templates/{id:number}', 'update')->setName('export.templates.update');
    Route::delete('/templates/{id:number}', 'destroy')->setName('export.templates.destroy');
});
