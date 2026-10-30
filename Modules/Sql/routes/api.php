<?php

declare(strict_types=1);

use PhpPgAdmin\Core\Facades\Route;
use PhpPgAdmin\Modules\Auth\Http\Middleware\Authenticate;
use PhpPgAdmin\Modules\Sql\Http\Controllers\BookmarkController;
use PhpPgAdmin\Modules\Sql\Http\Controllers\FindReplaceController;
use PhpPgAdmin\Modules\Sql\Http\Controllers\MacroController;
use PhpPgAdmin\Modules\Sql\Http\Controllers\QueryController;

// Queries run against a named database, or (without one) against the database the session
// landed in, which is what the server-level SQL page uses.
Route::middleware(Authenticate::class)->controller(QueryController::class)->group(function (): void {
    Route::post('/query', 'run')->setName('sql.query.server');
    Route::post('/query/cancel', 'cancel')->setName('sql.cancel');
    Route::post('/databases/{db}/query', 'run')->setName('sql.query');
    Route::get('/databases/{db}/query/columns', 'columns')->setName('sql.columns');
    Route::get('/databases/{db}/query/row', 'row')->setName('sql.row');
    Route::get('/databases/{db}/query/foreign-values', 'foreignValues')->setName('sql.foreign_values');
    Route::post('/databases/{db}/query/save', 'save')->setName('sql.save');
    Route::get('/databases/{db}/query/catalog', 'catalog')->setName('sql.catalog');
});

// A table's Find and replace: the preview of the values it changes, and the UPDATE.
Route::middleware(Authenticate::class)->controller(FindReplaceController::class)->group(function (): void {
    Route::post('/databases/{db}/query/find-replace/preview', 'preview')->setName('sql.find_replace.preview');
    Route::post('/databases/{db}/query/find-replace', 'replace')->setName('sql.find_replace');
});

// Saved queries and the query history are the role's, per server, not per database.
Route::middleware(Authenticate::class)->prefix('query')->controller(BookmarkController::class)->group(function (): void {
    Route::get('/bookmarks', 'index')->setName('sql.bookmarks');
    Route::post('/bookmarks', 'store')->setName('sql.bookmarks.store');
    Route::delete('/bookmarks/{id:number}', 'destroy')->setName('sql.bookmarks.destroy');
    Route::get('/history', 'history')->setName('sql.history');
});

// Query macros: the role's named statements with their shortcut keys, per server.
Route::middleware(Authenticate::class)->prefix('query')->controller(MacroController::class)->group(function (): void {
    Route::get('/macros', 'index')->setName('sql.macros');
    Route::post('/macros', 'store')->setName('sql.macros.store');
    Route::put('/macros/{id:number}', 'update')->setName('sql.macros.update');
    Route::delete('/macros/{id:number}', 'destroy')->setName('sql.macros.destroy');
});
