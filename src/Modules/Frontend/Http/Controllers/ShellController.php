<?php

declare(strict_types=1);

namespace PhpPgAdmin\Modules\Frontend\Http\Controllers;

use Nyholm\Psr7\Factory\Psr17Factory;
use PhpPgAdmin\Core\Frontend\Vite;
use Psr\Http\Message\ResponseInterface;
use Psr\Http\Message\ServerRequestInterface;

final class ShellController
{
    /** The Vite entry that bootstraps the UI. */
    private const string ENTRY = 'react-app/src/main.tsx';

    public function show(ServerRequestInterface $request): ResponseInterface
    {
        $tags = (new Vite())->tags([self::ENTRY]);

        $html = <<<HTML
        <!doctype html>
        <html lang="en">
          <head>
            <meta charset="UTF-8" />
            <meta name="viewport" content="width=device-width, initial-scale=1.0" />
            <title>phpPgAdmin</title>
            {$tags}
          </head>
          <body>
            <div id="root"></div>
          </body>
        </html>
        HTML;

        $response = (new Psr17Factory())->createResponse()->withHeader('content-type', 'text/html; charset=UTF-8');
        $response->getBody()->write($html);

        return $response;
    }
}
