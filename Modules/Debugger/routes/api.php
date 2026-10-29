<?php

declare(strict_types=1);

use PhpPgAdmin\Core\Facades\Route;
use PhpPgAdmin\Modules\Auth\Http\Middleware\Authenticate;
use PhpPgAdmin\Modules\Debugger\Http\Controllers\DebuggerController;

Route::middleware(Authenticate::class)->controller(DebuggerController::class)->group(function (): void {
    Route::get('/databases/{db}/debugger/status', 'status')->setName('debugger.status');
    Route::get('/databases/{db}/debugger/{oid:number}', 'target')->setName('debugger.target');
    Route::post('/databases/{db}/debugger/{oid:number}/sessions', 'start')->setName('debugger.start');
    Route::post('/debugger/sessions/{id:[0-9a-f]{24}}', 'command')->setName('debugger.command');
    Route::delete('/debugger/sessions/{id:[0-9a-f]{24}}', 'stop')->setName('debugger.stop');
    // navigator.sendBeacon can only POST: the page's stop when its tab is closed.
    Route::post('/debugger/sessions/{id:[0-9a-f]{24}}/stop', 'stop')->setName('debugger.stop.beacon');
    Route::post('/debugger/sessions/{id:[0-9a-f]{24}}/heartbeat', 'heartbeat')->setName('debugger.heartbeat');
});
