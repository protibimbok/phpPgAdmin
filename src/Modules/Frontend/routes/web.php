<?php

declare(strict_types=1);

use PhpPgAdmin\Core\Facades\Route;
use PhpPgAdmin\Modules\Frontend\Http\Controllers\ShellController;

// Everything except /api/... is the single-page application.
Route::get('/{path:(?!api(?:/|$)).*}', [ShellController::class, 'show'])->setName('frontend.shell');
