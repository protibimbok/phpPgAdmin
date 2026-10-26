<?php

declare(strict_types=1);

namespace PhpPgAdmin\Core\Nodes;

use PhpPgAdmin\Core\Sql\SqlTemplates;

/**
 * Assembles the reverse-engineered SQL pgAdmin shows on its "SQL" tab: a header naming the
 * object, the DROP statement as a comment, then the CREATE and whatever follows it.
 */
final class Ddl
{
    /**
     * "-- Table: public.t\n\n-- DROP TABLE IF EXISTS public.t;" The kind is written as pgAdmin
     * writes it for the node ("Table", "SCHEMA", "Database"); the drop statement is given
     * rendered (from the node's delete.sql) and commented out line by line.
     */
    public static function header(string $kind, string $qualifiedName, string $dropSql = ''): string
    {
        $header = sprintf('-- %s: %s', $kind, $qualifiedName);

        $drop = trim($dropSql);
        if ($drop !== '') {
            $header .= "\n\n" . implode("\n", array_map(static fn (string $line): string => '-- ' . $line, explode("\n", $drop)));
        }

        return $header;
    }

    /**
     * Join the parts with one blank line between them, dropping empty ones, and tidy the result.
     *
     * @param list<string|null> $parts
     */
    public static function assemble(array $parts): string
    {
        $parts = array_filter(array_map(static fn (?string $p): string => rtrim(ltrim((string) $p), "\n"), $parts), static fn (string $p): bool => trim($p) !== '');

        return SqlTemplates::tidy(implode("\n\n", $parts));
    }
}
