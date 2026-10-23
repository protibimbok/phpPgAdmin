<?php

declare(strict_types=1);

use PhpPgAdmin\Core\Facades\Route;
use PhpPgAdmin\Modules\I18n\Http\Controllers\LocaleController;

Route::prefix('i18n')->controller(LocaleController::class)->group(function (): void {
    Route::get('/locales', 'index')->setName('i18n.locales');
    Route::put('/locale', 'update')->setName('i18n.locale.update');
    Route::get('/messages/{locale:[A-Za-z]{2,3}(?:[-_][A-Za-z0-9]{2,8})*}', 'messages')->setName('i18n.messages');
});
