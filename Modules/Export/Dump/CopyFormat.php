<?php

declare(strict_types=1);

namespace PhpPgAdmin\Modules\Export\Dump;

use PhpPgAdmin\Core\Database\Quoting;

/**
 * Rows as pg_dump writes them by default: COPY … FROM stdin, one line per row in COPY's text
 * format (tab-separated, backslash escapes, NULL as \N), and the "\." that ends the data.
 */
final class CopyFormat implements RowFormat
{
    public function __construct(private readonly string $table)
    {
    }

    public function head(array $columns): string
    {
        $names = array_map(static fn ($column): string => Quoting::ident($column->name), $columns);

        return sprintf("--\n-- Data for %s\n--\n\nCOPY %s (%s) FROM stdin;\n", $this->table, $this->table, implode(', ', $names));
    }

    public function rows(array $rows): string
    {
        $out = '';
        foreach ($rows as $row) {
            $out .= implode("\t", array_map(self::escape(...), $row)) . "\n";
        }

        return $out;
    }

    public function foot(): string
    {
        return "\\.\n\n";
    }

    /** A value as COPY's text format spells it. */
    public static function escape(?string $value): string
    {
        return $value === null ? '\N' : strtr($value, ['\\' => '\\\\', "\t" => '\t', "\n" => '\n', "\r" => '\r', "\x08" => '\b', "\f" => '\f', "\v" => '\v']);
    }
}
