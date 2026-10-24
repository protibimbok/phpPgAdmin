<?php

declare(strict_types=1);

namespace PhpPgAdmin\Modules\Frontend\Http\Controllers;

use Nyholm\Psr7\Factory\Psr17Factory;
use PhpPgAdmin\App;
use PhpPgAdmin\Core\Contracts\ProvidesFrontendScripts;
use PhpPgAdmin\Core\Contracts\ProvidesViteEntries;
use PhpPgAdmin\Core\Facades\Lang;
use PhpPgAdmin\Core\Facades\Modules;
use PhpPgAdmin\Core\Frontend\Vite;
use PhpPgAdmin\Core\I18n\Locale;
use Psr\Http\Message\ResponseInterface;
use Psr\Http\Message\ServerRequestInterface;
use RuntimeException;

final class ShellController
{
    /** The Vite entry that bootstraps the UI. It runs last, after every module's frontend script. */
    private const string ENTRY = 'src/main.tsx';

    public function show(ServerRequestInterface $request): ResponseInterface
    {
        $tags = (new Vite())->tags([...$this->moduleScripts(), self::ENTRY]);

        // The locale SetLocale picked and the ones to offer, for the client's i18n to start from
        // without another request. The page is laid out in the locale's direction from the start.
        $locale = Lang::locale();
        $config = json_encode([
            'locale' => $locale->code,
            'locales' => array_values(array_map(static fn (Locale $l): array => $l->toArray(), Lang::locales())),
        ], JSON_THROW_ON_ERROR | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_HEX_TAG | JSON_HEX_AMP | JSON_HEX_APOS | JSON_HEX_QUOT);

        $html = <<<HTML
        <!doctype html>
        <html lang="{$locale->code}" dir="{$locale->direction->value}">
          <head>
            <meta charset="UTF-8" />
            <meta name="viewport" content="width=device-width, initial-scale=1.0" />
            <title>phpPgAdmin</title>
            <link rel="icon" href="/favicon.ico" sizes="48x48" />
            <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
            <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
            <script id="app-config" type="application/json">{$config}</script>
            {$tags}
          </head>
          <body>
            <div id="root"></div>
          </body>
        </html>
        HTML;

        $response = (new Psr17Factory())->createResponse()
            ->withHeader('content-type', 'text/html; charset=UTF-8')
            ->withHeader('vary', 'Accept-Language, Cookie');
        $response->getBody()->write($html);

        return $response;
    }

    /**
     * The frontend scripts of every module, as Vite entries relative to the project root, in
     * module order. Each registers its pages and tabs at its top level, before the entry runs.
     *
     * @return list<string>
     */
    private function moduleScripts(): array
    {
        $scripts = [];
        $base = rtrim(str_replace('\\', '/', App::basePath()), '/') . '/';

        foreach (Modules::providing(ProvidesFrontendScripts::class) as $module) {
            $declared = $module instanceof ProvidesViteEntries ? $module->viteEntries() : [];
            $path = str_replace('\\', '/', Modules::path($module, ''));
            $relative = str_starts_with($path, $base) ? substr($path, strlen($base)) : $path;

            foreach ($module->frontendScripts() as $script) {
                if (!in_array($script, $declared, true)) {
                    throw new RuntimeException(sprintf(
                        'Frontend script [%s] is not declared by [%s::viteEntries()].', $script, $module::class,
                    ));
                }

                $scripts[] = rtrim($relative, '/') . '/' . ltrim($script, '/');
            }
        }

        return $scripts;
    }
}
