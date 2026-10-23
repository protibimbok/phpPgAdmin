<?php

declare(strict_types=1);

namespace PhpPgAdmin\Core\I18n;

use InvalidArgumentException;
use JsonException;
use RuntimeException;

/**
 * Looks messages up in the modules' JSON message files.
 *
 * Every module registers its message directory under its name as a namespace, and a key names the
 * namespace and the path into the nested JSON: "auth::login.title". The files use the format the
 * React side reads with i18next, so a string is written once for both:
 *
 *   - placeholders are "{{name}}" and filled from $replace,
 *   - plurals are "key_one" / "key_other" (and optionally "key_zero") chosen by $replace['count'].
 *
 * A key the current locale lacks falls back to the fallback locale, and then to the key itself.
 */
final class Translator
{
    public const string NAMESPACE_SEPARATOR = '::';

    /** @var array<string, string> namespace => directory */
    private array $namespaces = [];

    /** @var array<string, array<string, array<string, string>>> locale => namespace => flattened messages */
    private array $loaded = [];

    private Locale $locale;

    private readonly Locale $fallback;

    /** @var array<string, Locale> keyed by code */
    private readonly array $locales;

    /**
     * @param non-empty-array<string, Locale> $locales
     */
    public function __construct(array $locales, string $default, ?string $fallback = null)
    {
        if ($locales === []) {
            throw new InvalidArgumentException('At least one locale must be configured.');
        }

        $this->locales = $locales;
        $this->locale = $locales[$default] ?? throw new InvalidArgumentException(sprintf('The default locale [%s] is not configured.', $default));
        $this->fallback = $locales[$fallback ?? $default] ?? throw new InvalidArgumentException(sprintf('The fallback locale [%s] is not configured.', (string) $fallback));
    }

    /**
     * @param array{default?: string, fallback?: string, locales?: array<string, array{name?: string, native?: string, dir?: string}>} $config
     */
    public static function fromConfig(array $config): self
    {
        $locales = [];
        foreach ($config['locales'] ?? ['en' => ['name' => 'English']] as $code => $attributes) {
            $locales[$code] = Locale::fromConfig((string) $code, $attributes);
        }

        return new self($locales, $config['default'] ?? array_key_first($locales), $config['fallback'] ?? null);
    }

    // ---- namespaces ----------------------------------------------------------------

    /**
     * Read "<directory>/<locale>.json" for the keys under "<namespace>::".
     */
    public function addNamespace(string $namespace, string $directory): void
    {
        $this->namespaces[$namespace] = rtrim($directory, '/\\');
        $this->loaded = [];
    }

    /** @return array<string, string> namespace => directory */
    public function namespaces(): array
    {
        return $this->namespaces;
    }

    // ---- locales -------------------------------------------------------------------

    public function locale(): Locale
    {
        return $this->locale;
    }

    public function fallback(): Locale
    {
        return $this->fallback;
    }

    public function setLocale(Locale|string $locale): void
    {
        $this->locale = $locale instanceof Locale
            ? $locale
            : ($this->find($locale) ?? throw new InvalidArgumentException(sprintf('The locale [%s] is not supported.', $locale)));
    }

    /** @return array<string, Locale> keyed by code */
    public function locales(): array
    {
        return $this->locales;
    }

    public function isSupported(string $code): bool
    {
        return $this->find($code) !== null;
    }

    /**
     * The configured locale a code refers to: an exact match first ("pt-BR"), then the
     * locale whose language matches ("pt-BR" finds "pt"). Case does not matter.
     */
    public function find(string $code): ?Locale
    {
        $code = str_replace('_', '-', trim($code));
        if ($code === '') {
            return null;
        }

        foreach ($this->locales as $locale) {
            if (strcasecmp(str_replace('_', '-', $locale->code), $code) === 0) {
                return $locale;
            }
        }

        $language = strtolower((string) preg_split('/-/', $code)[0]);
        foreach ($this->locales as $locale) {
            if ($locale->language() === $language) {
                return $locale;
            }
        }

        return null;
    }

    // ---- messages ------------------------------------------------------------------

    /**
     * @param array<string, scalar|\Stringable|null> $replace
     */
    public function get(string $key, array $replace = [], Locale|string|null $locale = null): string
    {
        $locale = $this->resolveLocale($locale);

        $message = $this->lookup($key, $replace, $locale->code);
        if ($message === null && $locale->code !== $this->fallback->code) {
            $message = $this->lookup($key, $replace, $this->fallback->code);
        }

        return $this->interpolate($message ?? $key, $replace);
    }

    public function has(string $key, Locale|string|null $locale = null): bool
    {
        return $this->lookup($key, [], $this->resolveLocale($locale)->code) !== null;
    }

    /**
     * Every message of the locale, nested as in the files and keyed by namespace. What a client
     * that does not bundle the files itself fetches.
     *
     * @return array<string, array<string, mixed>>
     */
    public function messages(Locale|string|null $locale = null): array
    {
        $code = $this->resolveLocale($locale)->code;

        $messages = [];
        foreach (array_keys($this->namespaces) as $namespace) {
            $messages[$namespace] = $this->read($namespace, $code);
        }

        return $messages;
    }

    /** @param array<string, scalar|\Stringable|null> $replace */
    private function lookup(string $key, array $replace, string $locale): ?string
    {
        [$namespace, $path] = $this->split($key);
        if ($namespace === null || !isset($this->namespaces[$namespace])) {
            return null;
        }

        $messages = $this->loaded[$locale][$namespace] ??= self::flatten($this->read($namespace, $locale));

        if (isset($replace['count']) && is_numeric($replace['count'])) {
            foreach (self::pluralSuffixes((float) $replace['count']) as $suffix) {
                if (isset($messages[$path . $suffix])) {
                    return $messages[$path . $suffix];
                }
            }
        }

        return $messages[$path] ?? null;
    }

    /** @return array{0: string|null, 1: string} */
    private function split(string $key): array
    {
        $at = strpos($key, self::NAMESPACE_SEPARATOR);
        if ($at === false || $at === 0) {
            return [null, $key];
        }

        return [substr($key, 0, $at), substr($key, $at + strlen(self::NAMESPACE_SEPARATOR))];
    }

    /** @return array<string, mixed> */
    private function read(string $namespace, string $locale): array
    {
        $file = $this->namespaces[$namespace] . '/' . $locale . '.json';
        if (!is_file($file)) {
            return [];
        }

        try {
            $messages = json_decode((string) file_get_contents($file), true, 512, JSON_THROW_ON_ERROR);
        } catch (JsonException $e) {
            throw new RuntimeException(sprintf('The message file %s is not valid JSON: %s', $file, $e->getMessage()), 0, $e);
        }

        if (!is_array($messages)) {
            throw new RuntimeException(sprintf('The message file %s must hold a JSON object.', $file));
        }

        /** @var array<string, mixed> $messages */
        return $messages;
    }

    /**
     * Nested messages to "a.b.c" => "message".
     *
     * @param array<string, mixed> $messages
     * @return array<string, string>
     */
    private static function flatten(array $messages, string $prefix = ''): array
    {
        $flat = [];
        foreach ($messages as $key => $value) {
            $path = $prefix === '' ? (string) $key : $prefix . '.' . $key;
            if (is_array($value)) {
                $flat += self::flatten($value, $path);
            } elseif (is_scalar($value)) {
                $flat[$path] = (string) $value;
            }
        }

        return $flat;
    }

    /**
     * The i18next plural suffixes to try, most specific first. Only "one" and "other" are
     * distinguished (plus "zero" when present), which is what the bundled locales need.
     *
     * @return list<string>
     */
    private static function pluralSuffixes(float $count): array
    {
        return match (true) {
            $count === 0.0 => ['_zero', '_other'],
            $count === 1.0 => ['_one', '_other'],
            default => ['_other'],
        };
    }

    /** @param array<string, scalar|\Stringable|null> $replace */
    private function interpolate(string $message, array $replace): string
    {
        if ($replace === [] || !str_contains($message, '{{')) {
            return $message;
        }

        return (string) preg_replace_callback(
            '/\{\{\s*([A-Za-z0-9_.]+)\s*\}\}/',
            static fn (array $m): string => array_key_exists($m[1], $replace) ? (string) $replace[$m[1]] : $m[0],
            $message,
        );
    }

    private function resolveLocale(Locale|string|null $locale): Locale
    {
        if ($locale === null) {
            return $this->locale;
        }

        if ($locale instanceof Locale) {
            return $locale;
        }

        return $this->find($locale) ?? throw new InvalidArgumentException(sprintf('The locale [%s] is not supported.', $locale));
    }
}
