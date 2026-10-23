<?php

declare(strict_types=1);

use PhpPgAdmin\Core\Http\Middleware\ParseJsonBody;
use PhpPgAdmin\Modules\Auth\Http\Middleware\StartSession;
use PhpPgAdmin\Modules\I18n\Http\Middleware\SetLocale;

return [

    /*
    |--------------------------------------------------------------------------
    | Module Routes
    |--------------------------------------------------------------------------
    |
    | Group attributes applied to the routes every module provides. Routes
    | from ProvidesRoutes are wrapped in the "web" group and routes from
    | ProvidesApiRoutes in the "api" group. Middleware are PSR-15 classes.
    | SetLocale reads the saved locale from the session, so it follows StartSession.
    |
    */

    'routes' => [

        'web' => [
            'middleware' => [StartSession::class, SetLocale::class],
        ],

        'api' => [
            'prefix' => 'api',
            'middleware' => [StartSession::class, SetLocale::class, ParseJsonBody::class],
        ],

    ],

];
