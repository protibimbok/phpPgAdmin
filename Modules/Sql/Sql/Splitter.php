<?php

declare(strict_types=1);

namespace PhpPgAdmin\Modules\Sql\Sql;

/**
 * Splits a batch into statements the way psql does, honouring 'strings' (and E'' escapes),
 * "identifiers", $tag$ dollar quotes $tag$, -- line comments and nested block comments;
 * and tells, from the top-level keywords of a statement, what the runner may do with it.
 *
 * Only what is outside quotes and comments is inspected, so a statement is never cut inside
 * a function body, and a keyword inside a string never counts.
 */
final class Splitter
{
    /** The statements whose rows a lone SELECT-like statement may be paged through. */
    private const array ROW_RETURNING = ['SELECT' => true, 'VALUES' => true, 'TABLE' => true, 'WITH' => true];

    /** A top-level keyword that makes a WITH statement write data, or a SELECT create a table. */
    private const array NOT_PAGEABLE = ['INSERT' => true, 'UPDATE' => true, 'DELETE' => true, 'MERGE' => true, 'INTO' => true];

    /** A top-level clause the statement already has, so paging must not add another. */
    private const array LIMITING = ['LIMIT' => true, 'OFFSET' => true, 'FETCH' => true, 'FOR' => true];

    /**
     * @return list<Statement>
     */
    public static function split(string $text, string $delimiter = ';'): array
    {
        $delimiter = $delimiter === '' ? ';' : $delimiter;
        $statements = [];
        $start = 0;
        $length = strlen($text);
        $i = 0;

        while ($i < $length) {
            $skipped = self::skipQuotedOrComment($text, $i, $length);
            if ($skipped !== null) {
                $i = $skipped;
                continue;
            }

            if (substr_compare($text, $delimiter, $i, strlen($delimiter)) === 0) {
                self::push($statements, $text, $start, $i);
                $i += strlen($delimiter);
                $start = $i;
                continue;
            }

            $i++;
        }

        self::push($statements, $text, $start, $length);

        return $statements;
    }

    /**
     * The first keyword of the statement, upper-cased: "SELECT", "WITH", "EXPLAIN"; "" when
     * the statement has none. Leading parentheses are skipped, so "(SELECT 1)" is a SELECT.
     */
    public static function firstKeyword(string $sql): string
    {
        $words = self::topLevelWords($sql, 1);

        return $words[0] ?? '';
    }

    /**
     * True when the statement returns rows that may be paged by wrapping it in
     * "SELECT * FROM (…) _pga LIMIT n OFFSET m": a SELECT, VALUES, TABLE or WITH … SELECT that
     * neither writes data nor has a limiting clause of its own.
     */
    public static function isPageable(string $sql): bool
    {
        $words = self::topLevelWords($sql);
        if ($words === [] || !isset(self::ROW_RETURNING[$words[0]])) {
            return false;
        }

        foreach ($words as $word) {
            if (isset(self::NOT_PAGEABLE[$word]) || isset(self::LIMITING[$word])) {
                return false;
            }
        }

        return true;
    }

    /** True for a SELECT, VALUES, TABLE or WITH, whatever else they do: what "Explain SQL" may be offered on. */
    public static function isSelect(string $sql): bool
    {
        return isset(self::ROW_RETURNING[self::firstKeyword($sql)]);
    }

    /**
     * The keywords of the statement at parenthesis depth 0 (plus the very first one, which may
     * sit inside parentheses), upper-cased, in order, up to $max of them; anything quoted,
     * commented or inside parentheses is skipped.
     *
     * @return list<string>
     */
    private static function topLevelWords(string $sql, int $max = PHP_INT_MAX): array
    {
        $words = [];
        $depth = 0;
        $length = strlen($sql);
        $i = 0;

        while ($i < $length && count($words) < $max) {
            $skipped = self::skipQuotedOrComment($sql, $i, $length);
            if ($skipped !== null) {
                $i = $skipped;
                continue;
            }

            $c = $sql[$i];
            if ($c === '(') {
                $depth++;
                $i++;
            } elseif ($c === ')') {
                $depth = max(0, $depth - 1);
                $i++;
            } elseif (($depth === 0 || $words === []) && (ctype_alpha($c) || $c === '_')) {
                // The first word counts whatever its depth, so "(SELECT 1) UNION (SELECT 2)" reads as a SELECT.
                $j = $i + 1;
                while ($j < $length && (ctype_alnum($sql[$j]) || $sql[$j] === '_')) {
                    $j++;
                }
                $words[] = strtoupper(substr($sql, $i, $j - $i));
                $i = $j;
            } elseif ($depth === 0 && ctype_digit($c)) {
                // A number: skip it whole so "1e5" is not read as the keyword "e5".
                $j = $i + 1;
                while ($j < $length && (ctype_alnum($sql[$j]) || $sql[$j] === '.')) {
                    $j++;
                }
                $i = $j;
            } else {
                $i++;
            }
        }

        return $words;
    }

    /**
     * When $i is at the start of a string, identifier, dollar quote or comment, the offset just
     * past its end (or the text's end when it is not closed); null otherwise.
     */
    private static function skipQuotedOrComment(string $text, int $i, int $length): ?int
    {
        $c = $text[$i];

        if ($c === "'") {
            // E'…' strings honour backslash escapes; the standard string only doubles its quotes.
            $escapes = $i > 0 && ($text[$i - 1] === 'E' || $text[$i - 1] === 'e') && ($i < 2 || !ctype_alnum($text[$i - 2]) && $text[$i - 2] !== '_');
            $j = $i + 1;
            while ($j < $length) {
                if ($escapes && $text[$j] === '\\') {
                    $j += 2;
                    continue;
                }
                if ($text[$j] === "'") {
                    if ($j + 1 < $length && $text[$j + 1] === "'") {
                        $j += 2;
                        continue;
                    }

                    return $j + 1;
                }
                $j++;
            }

            return $length;
        }

        if ($c === '"') {
            $j = $i + 1;
            while ($j < $length) {
                if ($text[$j] === '"') {
                    if ($j + 1 < $length && $text[$j + 1] === '"') {
                        $j += 2;
                        continue;
                    }

                    return $j + 1;
                }
                $j++;
            }

            return $length;
        }

        if ($c === '$' && preg_match('/\G\$([A-Za-z_\x80-\xff][A-Za-z0-9_\x80-\xff]*)?\$/', $text, $m, 0, $i) === 1) {
            $tag = $m[0];
            $end = strpos($text, $tag, $i + strlen($tag));

            return $end === false ? $length : $end + strlen($tag);
        }

        if ($c === '-' && $i + 1 < $length && $text[$i + 1] === '-') {
            $end = strpos($text, "\n", $i);

            return $end === false ? $length : $end + 1;
        }

        if ($c === '/' && $i + 1 < $length && $text[$i + 1] === '*') {
            $depth = 1;
            $j = $i + 2;
            while ($j < $length && $depth > 0) {
                if ($text[$j] === '/' && $j + 1 < $length && $text[$j + 1] === '*') {
                    $depth++;
                    $j += 2;
                } elseif ($text[$j] === '*' && $j + 1 < $length && $text[$j + 1] === '/') {
                    $depth--;
                    $j += 2;
                } else {
                    $j++;
                }
            }

            return $j;
        }

        return null;
    }

    /**
     * Add the text between the offsets as a statement, unless it holds nothing but whitespace
     * and comments.
     *
     * @param list<Statement> $statements
     */
    private static function push(array &$statements, string $text, int $from, int $to): void
    {
        $raw = substr($text, $from, $to - $from);
        $sql = trim($raw);
        if ($sql === '' || self::topLevelWords($sql, 1) === [] && !preg_match('/[^\s]/', self::stripComments($sql))) {
            return;
        }

        $offset = $from + strlen($raw) - strlen(ltrim($raw));

        $statements[] = new Statement($sql, substr_count($text, "\n", 0, $offset) + 1, $offset);
    }

    /** The text with its comments removed, to tell a comment-only chunk from a statement. */
    private static function stripComments(string $sql): string
    {
        $out = '';
        $length = strlen($sql);
        $i = 0;
        while ($i < $length) {
            $c = $sql[$i];
            if (($c === '-' || $c === '/') && ($skipped = self::skipQuotedOrComment($sql, $i, $length)) !== null) {
                $i = $skipped;
                continue;
            }
            $out .= $c;
            $i++;
        }

        return $out;
    }
}
