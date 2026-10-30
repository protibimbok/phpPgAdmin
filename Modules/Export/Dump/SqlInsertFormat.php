<?php

declare(strict_types=1);

namespace PhpPgAdmin\Modules\Export\Dump;

use PhpPgAdmin\Core\Database\Quoting;

/**
 * Rows as INSERT statements, with pg_dump's choices: the column names spelled out or not
 * (--column-inserts), one row per statement or up to rowsPerInsert (--rows-per-insert), and
 * ON CONFLICT DO NOTHING. Numbers and booleans are written bare, as pg_dump writes them;
 * other values as quoted literals, which PostgreSQL casts to the column's type; NULL stays NULL.
 */
final class SqlInsertFormat implements RowFormat
{
    /** int2, int4, int8, oid, float4, float8, numeric, and bool. */
    private const array BARE = [21, 23, 20, 26, 700, 701, 1700, 16];

    /** @var list<string> */
    private array $names = [];

    /** @var list<bool> whether each column's values are written bare */
    private array $bare = [];

    public function __construct(
        private readonly string $table,
        private readonly bool $columns,
        private readonly int $rowsPerInsert,
        private readonly bool $onConflictDoNothing,
    ) {
    }

    public function head(array $columns): string
    {
        $this->names = array_map(static fn ($column): string => Quoting::ident($column->name), $columns);
        $this->bare = array_map(static fn ($column): bool => in_array($column->typeOid, self::BARE, true), $columns);

        return sprintf("--\n-- Data for %s\n--\n\n", $this->table);
    }

    public function rows(array $rows): string
    {
        $into = 'INSERT INTO ' . $this->table . ($this->columns ? ' (' . implode(', ', $this->names) . ')' : '') . ' VALUES';
        $tail = ($this->onConflictDoNothing ? ' ON CONFLICT DO NOTHING' : '') . ";\n";
        $out = '';
        foreach (array_chunk($rows, $this->rowsPerInsert) as $chunk) {
            $values = array_map(fn (array $row): string => '(' . implode(', ', array_map($this->value(...), $row, array_keys($row))) . ')', $chunk);
            $out .= $into . (count($values) === 1 ? ' ' . $values[0] : "\n\t" . implode(",\n\t", $values)) . $tail;
        }

        return $out;
    }

    private function value(?string $value, int $i): string
    {
        if ($value === null) {
            return 'NULL';
        }
        if ($this->bare[$i] ?? false) {
            // NaN and Infinity are words, which only a literal can carry.
            return match ($value) {
                't' => 'true',
                'f' => 'false',
                'NaN', 'Infinity', '-Infinity' => Quoting::literal($value),
                default => $value,
            };
        }

        return Quoting::literal($value);
    }

    public function foot(): string
    {
        return '';
    }
}
