<?php

declare(strict_types=1);

use PhpPgAdmin\Modules\Auth\AuthModule;
use PhpPgAdmin\Modules\Frontend\FrontendModule;

/**
 * Every module the application loads. The order of the list is the order the modules are wired in.
 */
return [
    AuthModule::class,
    FrontendModule::class,
];
