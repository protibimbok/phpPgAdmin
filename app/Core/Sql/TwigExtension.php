<?php

declare(strict_types=1);

namespace PhpPgAdmin\Core\Sql;

use PhpPgAdmin\Core\Database\Connection;
use PhpPgAdmin\Core\Database\Quoting;
use PhpPgAdmin\Core\Nodes\Options;
use Twig\Extension\AbstractExtension;
use Twig\TwigFilter;
use Twig\TwigFunction;
use Twig\TwigTest;

/**
 * What pgAdmin's templates use from Jinja and its driver, for the ported templates to read
 * the same: the quoting filters (`conn|qtIdent(schema, name)`, `value|qtLiteral(conn)`),
 * Python's `string`/`int`/`rstrip`/`tojson`, the `none` test and `namespace()`.
 *
 * The qtIdent filters take the connection as the filtered value and ignore it, exactly as
 * pgAdmin's do; qtLiteral uses the connection's own escaping when one is given.
 */
final class TwigExtension extends AbstractExtension
{
    public function getFilters(): array
    {
        return [
            new TwigFilter('qtIdent', static fn (mixed $conn, string|int|null ...$parts): string => Quoting::ident(...$parts)),
            new TwigFilter('qtTypeIdent', static fn (mixed $conn, string|int|null ...$parts): string => Quoting::typeIdent(...$parts)),
            new TwigFilter('qtLiteral', self::literal(...)),
            new TwigFilter('string', static fn (mixed $value): string => self::string($value)),
            new TwigFilter('int', static fn (mixed $value): int => is_numeric($value) ? (int) $value : 0),
            new TwigFilter('rstrip', static fn (?string $value, string $chars = " \t\n\r"): string => rtrim((string) $value, $chars)),
            // Jinja's |lower on a boolean is Python's str(): 'true' / 'false'. pgAdmin's templates rely on it
            // for the reloptions they print ("security_barrier={{ data.security_barrier|lower }}").
            new TwigFilter('lower', static fn (mixed $value): string => match (true) { $value === null => '', is_bool($value) => $value ? 'true' : 'false', default => mb_strtolower(self::string($value)) }),
            new TwigFilter('tojson', static fn (mixed $value): string => json_encode($value, JSON_THROW_ON_ERROR | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE)),
            // Python's list() and Jinja's unique: a PostgreSQL array string becomes a list too.
            new TwigFilter('list', static fn (mixed $value): array => is_array($value) ? array_values($value) : Options::list($value)),
            new TwigFilter('unique', static fn (mixed $value): array => array_values(array_unique(is_array($value) ? $value : Options::list($value)))),
        ];
    }

    public function getFunctions(): array
    {
        return [
            new TwigFunction('namespace', static fn (array $values = []): TemplateNamespace => new TemplateNamespace($values)),
            // pgAdmin passes gettext as "_" for the column titles of its statistics queries.
            new TwigFunction('_', static fn (string $message): string => $message),
            // Python's range(n) counts 0..n-1; Twig's range(a, b) is inclusive. Support both forms.
            new TwigFunction('range', static fn (int|float|string $low, int|float|string|null $high = null, int|float $step = 1): array => $high === null ? ((int) $low > 0 ? range(0, (int) $low - 1) : []) : range($low, $high, $step)),
        ];
    }

    public function getTests(): array
    {
        return [
            new TwigTest('none', static fn (mixed $value): bool => $value === null),
        ];
    }

    /** `value|qtLiteral(conn)`: a quoted SQL literal, through the connection when there is one. */
    public static function literal(mixed $value, mixed $conn = null, bool $forceQuote = false): string
    {
        if ($conn instanceof Connection && is_string($value)) {
            return $conn->escapeLiteral($value);
        }

        $literal = Quoting::literal(is_array($value) || is_scalar($value) || $value === null || $value instanceof \Stringable ? $value : self::string($value));

        if ($forceQuote && !str_starts_with($literal, "'")) {
            return "'" . $literal . "'";
        }

        return $literal;
    }

    /** Python's str(): "True"/"False" for booleans, "None" for null. */
    private static function string(mixed $value): string
    {
        return match (true) {
            $value === null => 'None',
            $value === true => 'True',
            $value === false => 'False',
            is_array($value) => json_encode($value, JSON_THROW_ON_ERROR),
            default => (string) $value,
        };
    }
}
