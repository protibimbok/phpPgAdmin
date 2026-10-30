<?php

declare(strict_types=1);

use PhpPgAdmin\Core\Facades\Route;
use PhpPgAdmin\Modules\Auth\Http\Middleware\Authenticate;
use PhpPgAdmin\Modules\SchemaDiff\Http\Controllers\SchemaDiffController;

Route::middleware(Authenticate::class)->controller(SchemaDiffController::class)->group(function (): void {
    Route::get('/schema-diff/options', 'options')->setName('schemadiff.options');
    Route::post('/schema-diff/connect', 'connect')->setName('schemadiff.connect');
    Route::post('/schema-diff/compare', 'compare')->setName('schemadiff.compare');
    Route::post('/schema-diff/ddl', 'ddl')->setName('schemadiff.ddl');
    Route::post('/schema-diff/script', 'script')->setName('schemadiff.script');
});
