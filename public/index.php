<?php

declare(strict_types=1);

require __DIR__ . '/../vendor/autoload.php';

use Nyholm\Psr7\Factory\Psr17Factory;
use Nyholm\Psr7Server\ServerRequestCreator;
use PhpPgAdmin\App;
use PhpPgAdmin\Core\Http\ResponseEmitter;

$debug = (getenv('APP_DEBUG') ?: 'false') === 'true';

$psr17 = new Psr17Factory();
$request = (new ServerRequestCreator($psr17, $psr17, $psr17, $psr17))->fromGlobals();

(new ResponseEmitter())->emit(App::create($debug)->handle($request));
