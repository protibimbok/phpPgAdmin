<?php

declare(strict_types=1);

namespace PhpPgAdmin\Core\Frontend;

use PhpPgAdmin\App;
use RuntimeException;

/**
 * The HTML tags that load Vite entries, like Laravel's @vite directive.
 *
 * While `vite dev` runs it leaves public/hot with its URL and the tags point at the dev
 * server. Otherwise they come from the manifest `vite build` writes to public/dist.
 */
final class Vite
{
    /** @var array<string, array{file: string, css?: list<string>, imports?: list<string>}>|null */
    private ?array $manifest = null;

    public function __construct(
        private readonly string $hotFile = 'public/hot',
        private readonly string $buildDirectory = 'dist',
    ) {
    }

    /** @param list<string> $entries Source paths relative to the project root, e.g. "react-app/src/main.tsx". */
    public function tags(array $entries): string
    {
        $hot = $this->hotUrl();

        if ($hot !== null) {
            $tags = [
                $this->script($hot . '/@vite/client'),
                $this->reactRefresh($hot),
            ];
            foreach ($entries as $entry) {
                $tags[] = self::isCss($entry) ? $this->stylesheet($hot . '/' . $entry) : $this->script($hot . '/' . $entry);
            }

            return implode("\n", $tags);
        }

        $tags = [];
        $seen = [];
        foreach ($entries as $entry) {
            $this->collect($entry, $tags, $seen, true);
        }

        // Stylesheets first so the page does not flash unstyled, then scripts, then preloads.
        uksort($tags, static fn (string $a, string $b): int => self::order($a) <=> self::order($b));

        return implode("\n", $tags);
    }

    /** @param array<string, string> $tags  @param array<string, true> $seen */
    private function collect(string $key, array &$tags, array &$seen, bool $entry): void
    {
        if (isset($seen[$key])) {
            return;
        }
        $seen[$key] = true;

        $chunk = $this->manifest()[$key] ?? throw new RuntimeException(sprintf(
            'Vite entry [%s] is missing from public/%s/manifest.json. Run "pnpm build" or "pnpm dev".',
            $key, $this->buildDirectory,
        ));

        foreach ($chunk['css'] ?? [] as $css) {
            $tags['css:' . $css] = $this->stylesheet($this->asset($css));
        }

        $url = $this->asset($chunk['file']);
        if ($entry) {
            $tags['js:' . $url] = self::isCss($key) ? $this->stylesheet($url) : $this->script($url);
        } else {
            $tags['preload:' . $url] = sprintf('<link rel="modulepreload" href="%s">', self::e($url));
        }

        foreach ($chunk['imports'] ?? [] as $import) {
            $this->collect($import, $tags, $seen, false);
        }
    }

    private static function order(string $key): int
    {
        return match (strtok($key, ':')) {
            'css' => 0,
            'js' => 1,
            default => 2,
        };
    }

    /** @return array<string, array{file: string, css?: list<string>, imports?: list<string>}> */
    private function manifest(): array
    {
        if ($this->manifest !== null) {
            return $this->manifest;
        }

        $path = App::basePath('public/' . $this->buildDirectory . '/manifest.json');
        if (!is_file($path)) {
            throw new RuntimeException(sprintf('Vite manifest not found at %s. Run "pnpm build" or "pnpm dev".', $path));
        }

        /** @var array<string, array{file: string, css?: list<string>, imports?: list<string>}> */
        return $this->manifest = json_decode((string) file_get_contents($path), true, 512, JSON_THROW_ON_ERROR);
    }

    private function hotUrl(): ?string
    {
        $path = App::basePath($this->hotFile);

        return is_file($path) ? rtrim(trim((string) file_get_contents($path)), '/') : null;
    }

    private function asset(string $file): string
    {
        return '/' . $this->buildDirectory . '/' . ltrim($file, '/');
    }

    private function script(string $url): string
    {
        return sprintf('<script type="module" src="%s"></script>', self::e($url));
    }

    private function stylesheet(string $url): string
    {
        return sprintf('<link rel="stylesheet" href="%s">', self::e($url));
    }

    /** The preamble @vitejs/plugin-react needs before any module when it runs under the dev server. */
    private function reactRefresh(string $hot): string
    {
        return <<<HTML
        <script type="module">
            import RefreshRuntime from '{$hot}/@react-refresh'
            RefreshRuntime.injectIntoGlobalHook(window)
            window.\$RefreshReg\$ = () => {}
            window.\$RefreshSig\$ = () => (type) => type
            window.__vite_plugin_react_preamble_installed__ = true
        </script>
        HTML;
    }

    private static function isCss(string $path): bool
    {
        return (bool) preg_match('/\.(css|less|sass|scss|styl|stylus|pcss|postcss)$/', $path);
    }

    private static function e(string $value): string
    {
        return htmlspecialchars($value, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
    }
}
