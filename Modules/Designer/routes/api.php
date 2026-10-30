<?php

declare(strict_types=1);

use PhpPgAdmin\Core\Facades\Route;
use PhpPgAdmin\Modules\Auth\Http\Middleware\Authenticate;
use PhpPgAdmin\Modules\Designer\Http\Controllers\DesignerController;

Route::middleware(Authenticate::class)->controller(DesignerController::class)->group(function (): void {
    Route::get('/databases/{db}/designer', 'diagram')->setName('designer.diagram');
    Route::post('/databases/{db}/designer/relations', 'createRelation')->setName('designer.relations.create');
    Route::post('/databases/{db}/designer/relations/drop', 'dropRelation')->setName('designer.relations.drop');
    Route::post('/databases/{db}/designer/sql', 'sql')->setName('designer.sql');
    Route::post('/databases/{db}/designer/query', 'query')->setName('designer.query');
    Route::post('/databases/{db}/designer/junction', 'junction')->setName('designer.junction');
    Route::get('/databases/{db}/designer/pages', 'pages')->setName('designer.pages');
    Route::post('/databases/{db}/designer/pages', 'savePage')->setName('designer.pages.save');
    Route::delete('/databases/{db}/designer/pages/{id:number}', 'deletePage')->setName('designer.pages.delete');
});
