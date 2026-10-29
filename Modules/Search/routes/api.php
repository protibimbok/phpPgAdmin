<?php

declare(strict_types=1);

use PhpPgAdmin\Core\Facades\Route;
use PhpPgAdmin\Modules\Auth\Http\Middleware\Authenticate;
use PhpPgAdmin\Modules\Search\Http\Controllers\SearchController;

Route::middleware(Authenticate::class)->controller(SearchController::class)->group(function (): void {
    Route::get('/databases/{db}/search/options', 'options')->setName('search.options');
    Route::post('/databases/{db}/search/data', 'data')->setName('search.data');
    Route::post('/databases/{db}/search/objects', 'objects')->setName('search.objects');
});
