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
            <link rel="icon" href="/favicon.ico" sizes="48x48" />
            <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
            <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
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
