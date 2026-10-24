<?php

declare(strict_types=1);

namespace PhpPgAdmin\Core\Sql;

use Twig\Error\LoaderError;
use Twig\Loader\LoaderInterface;
use Twig\Source;

/**
 * Finds SQL templates across the registered roots, by server version, as pgAdmin's
 * VersionedTemplateLoader does.
 *
 * A name "tables/create.sql#150004" is the file "create.sql" of the "tables" folder for a
 * 15.4 server: the version folders are walked from the newest down ("18_plus", "17_plus", …
 * "default"), skipping those above the server's version, and the first that holds the file
 * wins. A name without "#version" ("macros/privilege.macros") is a plain path under a root.
 */
final class VersionedLoader implements LoaderInterface
{
    /** The version folders, newest first, with the lowest server version each applies to. */
    public const array VERSIONS = [
        '18_plus' => 180000,
        '17_plus' => 170000,
        '16_plus' => 160000,
        '15_plus' => 150000,
        '14_plus' => 140000,
        '13_plus' => 130000,
        '12_plus' => 120000,
        '11_plus' => 110000,
        'default' => 0,
    ];

    /** @var list<string> absolute directories, searched in order */
    private array $roots = [];

    /** @var array<string, string> template name => resolved file */
    private array $resolved = [];

    public function addRoot(string $directory): void
    {
        $this->roots[] = rtrim($directory, '/\\');
        $this->resolved = [];
    }

    /** @return list<string> */
    public function roots(): array
    {
        return $this->roots;
    }

    public function getSourceContext(string $name): Source
    {
        $path = $this->resolve($name);
        $code = file_get_contents($path);
        if ($code === false) {
            throw new LoaderError(sprintf('Unable to read the template "%s" at %s.', $name, $path));
        }

        return new Source($code, $name, $path);
    }

    /** The resolved file, so two versions resolving to the same file share one compiled template. */
    public function getCacheKey(string $name): string
    {
        return $this->resolve($name);
    }

    public function isFresh(string $name, int $time): bool
    {
        return filemtime($this->resolve($name)) <= $time;
    }

    public function exists(string $name): bool
    {
        try {
            $this->resolve($name);

            return true;
        } catch (LoaderError) {
            return false;
        }
    }

    /**
     * The absolute path a template name stands for.
     *
     * @throws LoaderError
     */
    public function resolve(string $name): string
    {
        if (isset($this->resolved[$name])) {
            return $this->resolved[$name];
        }

        if (str_contains($name, '..')) {
            throw new LoaderError(sprintf('Template name "%s" may not contain "..".', $name));
        }

        $path = preg_match('~^(?<dir>.+)/(?<file>[^/#]+)#(?<version>\d+)$~', $name, $m) === 1
            ? $this->resolveVersioned($m['dir'], $m['file'], (int) $m['version'], $name)
            : $this->resolvePlain($name);

        return $this->resolved[$name] = $path;
    }

    private function resolveVersioned(string $dir, string $file, int $version, string $name): string
    {
        foreach (self::VERSIONS as $folder => $minimum) {
            if ($minimum > $version) {
                continue;
            }

            foreach ($this->roots as $root) {
                $path = "{$root}/{$dir}/{$folder}/{$file}";
                if (is_file($path)) {
                    return $path;
                }
            }
        }

        throw new LoaderError(sprintf('No SQL template "%s/%s" for server version %d in %s.', $dir, $file, $version, implode(', ', $this->roots)));
    }

    private function resolvePlain(string $name): string
    {
        foreach ($this->roots as $root) {
            $path = "{$root}/" . ltrim($name, '/');
            if (is_file($path)) {
                return $path;
            }
        }

        throw new LoaderError(sprintf('No SQL template "%s" in %s.', $name, implode(', ', $this->roots)));
    }
}
