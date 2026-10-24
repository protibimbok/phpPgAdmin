<?php

declare(strict_types=1);

namespace PhpPgAdmin\Core\Sql;

use Twig\Environment;

/**
 * Renders the SQL templates: pgAdmin's catalog queries and DDL ported to Twig, picked per
 * server version. Templates are plain text, nothing is escaped, and an unknown variable is
 * empty, as in Jinja.
 *
 *     Sql::render('tables', 'properties.sql', ['scid' => 2200, 'conn' => $conn], $conn->version());
 */
final class SqlTemplates
{
    private readonly Environment $twig;

    public function __construct(
        private readonly VersionedLoader $loader,
        ?string $cacheDirectory = null,
    ) {
        $this->twig = new Environment($loader, [
            'autoescape' => false,
            'strict_variables' => false,
            'cache' => $cacheDirectory ?? false,
            'auto_reload' => true,
        ]);
        $this->twig->addExtension(new TwigExtension());
    }

    public function loader(): VersionedLoader
    {
        return $this->loader;
    }

    public function twig(): Environment
    {
        return $this->twig;
    }

    /** Add a directory of templates; later roots are searched after earlier ones. */
    public function addRoot(string $directory): void
    {
        $this->loader->addRoot($directory);
    }

    /**
     * Render the template `$file` of the node folder `$node` for a server of the given version
     * (150004 for 15.4). Runs of blank lines collapse to one and the result is trimmed, so the
     * SQL reads the same whatever the template's whitespace control.
     *
     * @param array<string, mixed> $vars
     */
    public function render(string $node, string $file, array $vars = [], int $serverVersion = 0): string
    {
        return self::tidy($this->twig->render("{$node}/{$file}#{$serverVersion}", $vars));
    }

    /** Render a template by its plain name, "macros/privilege.macros" or "depends/default/dependencies.sql". */
    public function renderPlain(string $name, array $vars = []): string
    {
        return self::tidy($this->twig->render($name, $vars));
    }

    /** Whether a node has the file for the version. */
    public function has(string $node, string $file, int $serverVersion = 0): bool
    {
        return $this->loader->exists("{$node}/{$file}#{$serverVersion}");
    }

    public static function tidy(string $sql): string
    {
        $sql = preg_replace("/[ \t]+\n/", "\n", $sql) ?? $sql;
        $sql = preg_replace("/\n{3,}/", "\n\n", $sql) ?? $sql;

        return trim($sql, "\n");
    }
}
