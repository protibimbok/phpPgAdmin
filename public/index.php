<?php

declare(strict_types=1);

require __DIR__ . '/../vendor/autoload.php';

use PhpPgAdmin\App;

echo (new App())->greet(), PHP_EOL;
