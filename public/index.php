<?php

declare(strict_types=1);

// PHP's built-in server (php -S ... public/index.php) routes every request here; let it serve real files itself.
if (PHP_SAPI === 'cli-server') {
    $file = __DIR__ . parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);
    if ($file !== __DIR__ . '/' && is_file($file)) {
        return false;
    }
}

require __DIR__ . '/../vendor/autoload.php';

use Nyholm\Psr7\Factory\Psr17Factory;
use Nyholm\Psr7Server\ServerRequestCreator;
use PhpPgAdmin\App;
use PhpPgAdmin\Core\Http\ResponseEmitter;

$debug = (getenv('APP_DEBUG') ?: 'false') === 'true';

$psr17 = new Psr17Factory();
$request = (new ServerRequestCreator($psr17, $psr17, $psr17, $psr17))->fromGlobals();

(new ResponseEmitter())->emit(App::create($debug)->handle($request));
