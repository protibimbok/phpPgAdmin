<?php

declare(strict_types=1);

namespace PhpPgAdmin\Core\Database;

/**
 * Quotes identifiers, type names and literals the way pgAdmin's driver does (qtIdent, qtTypeIdent,
 * qtLiteral in utils/driver/psycopg3/__init__.py), so the ported SQL templates render the same DDL.
 *
 * Identifiers are only quoted when they need it: a leading digit, a character outside [a-z0-9_],
 * or a keyword that is not unreserved. Literals are quoted without a connection, with the
 * standard_conforming_strings rules; prefer Connection::escapeLiteral() when a connection is at hand.
 */
final class Quoting
{
    /** Type names that contain a space but must not be quoted. */
    private const array UNQUOTED_TYPES = [
        'bit varying',
        '"char"',
        'character varying',
        'double precision',
        'timestamp without time zone',
        'timestamp with time zone',
        'time without time zone',
        'time with time zone',
        '"trigger"',
        '"unknown"',
    ];

    /**
     * A qualified identifier: the non-empty parts quoted where needed and joined with dots.
     * Quoting::ident('public', 'my table') is `public."my table"`.
     */
    public static function ident(string|int|null ...$parts): string
    {
        return self::join($parts, false);
    }

    /** Like ident(), with the leniency type names get: `character varying`, `"char"`, `integer[]`. */
    public static function typeIdent(string|int|null ...$parts): string
    {
        return self::join($parts, true);
    }

    /**
     * A literal for use in SQL: NULL, true/false, a bare number, a quoted string with its quotes
     * doubled (E-prefixed when it has a backslash), or an ARRAY[...] of these.
     *
     * @param scalar|array<mixed>|\Stringable|null $value
     */
    public static function literal(mixed $value): string
    {
        if ($value === null) {
            return 'NULL';
        }
        if (is_bool($value)) {
            return $value ? 'true' : 'false';
        }
        if (is_int($value) || is_float($value)) {
            return (string) $value;
        }
        if (is_array($value)) {
            return 'ARRAY[' . implode(', ', array_map(self::literal(...), $value)) . ']';
        }

        $string = (string) $value;
        $quoted = "'" . str_replace("'", "''", $string) . "'";

        return str_contains($string, '\\') ? 'E' . str_replace('\\', '\\\\', $quoted) : $quoted;
    }

    /** Whether an identifier must be double-quoted to survive as written. */
    public static function needsQuoting(string $value, bool $forTypes): bool
    {
        if ($value === '') {
            return false;
        }

        $noArray = $value;
        if ($forTypes && str_ends_with($value, '[]')) {
            $noArray = substr($value, 0, -2);
        }

        if ($forTypes && in_array(strtolower($noArray), self::UNQUOTED_TYPES, true)) {
            return false;
        }

        // Already quoted? Then do not quote again.
        if ($forTypes && $noArray !== '' && (str_starts_with($noArray, '"') || str_ends_with($noArray, '"'))) {
            return false;
        }

        if ($noArray === '' || ctype_digit($noArray[0])) {
            return true;
        }

        if (preg_match('/[^a-z_0-9]/', $noArray) === 1) {
            return true;
        }

        $category = Keywords::category($value);

        if ($category === null || $category === Keywords::UNRESERVED) {
            return false;
        }

        if ($forTypes && $category === Keywords::COL_NAME) {
            return false;
        }

        return true;
    }

    /** @param list<string|int|null> $parts */
    private static function join(array $parts, bool $forTypes): string
    {
        $quoted = [];

        foreach ($parts as $part) {
            $part = (string) ($part ?? '');
            if ($part === '') {
                continue;
            }

            $quoted[] = self::needsQuoting($part, $forTypes) ? '"' . str_replace('"', '""', $part) . '"' : $part;
        }

        return implode('.', $quoted);
    }
}
