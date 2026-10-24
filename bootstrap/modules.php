<?php

declare(strict_types=1);

use PhpPgAdmin\Modules\Auth\AuthModule;
use PhpPgAdmin\Modules\Databases\DatabasesModule;
use PhpPgAdmin\Modules\Frontend\FrontendModule;
use PhpPgAdmin\Modules\I18n\I18nModule;
use PhpPgAdmin\Modules\Server\ServerModule;

/**
 * Every module the application loads. The order of the list is the order the modules are wired in.
 */
return [
    I18nModule::class,
    AuthModule::class,
    ServerModule::class,
    DatabasesModule::class,
    FrontendModule::class,
];
