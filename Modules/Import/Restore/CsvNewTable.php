<?php

declare(strict_types=1);

namespace PhpPgAdmin\Modules\Import\Restore;

use PhpPgAdmin\Core\Database\Quoting;
use PhpPgAdmin\Core\Http\ApiException;

/**
 * phpMyAdmin's CSV import into a new table, at a database's or schema's scope: the columns come
 * from the file's first line when it holds the names (else "COL 1", "COL 2"…, as phpMyAdmin
 * names them), their types are guessed from every row (integer, bigint, numeric, boolean, date,
 * timestamp, else text) or all text, and CREATE TABLE runs in the same transaction as the COPY
 * that loads the rows.
 */
final readonly class CsvNewTable
{
    /** The types a column can be guessed as, narrowest first; text takes anything. */
    private const array TYPES = [
        'integer' => '/^[+-]?(0|[1-9]\d{0,9})$/',
        'bigint' => '/^[+-]?(0|[1-9]\d{0,18})$/',
        'numeric' => '/^[+-]?((0|[1-9]\d*)(\.\d*)?|\.\d+)([eE][+-]?\d+)?$/',
        'boolean' => '/^(true|false|t|f)$/i',
        'date' => '/^\d{4}-\d{2}-\d{2}$/',
        'timestamp without time zone' => '/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/',
        'timestamp with time zone' => '/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}(:?\d{2})?)$/',
    ];

    /**
     * @param list<string> $columns
     * @param list<string> $types
     */
    private function __construct(
        public string $schema,
        public string $table,
        public array $columns,
        public array $types,
    ) {
    }

    /** Reads the file's first line and, to guess the types, every row; the table to create. */
    public static function read(string $path, bool $gzip, CopyImport $copy, string $schema, string $table, bool $guessTypes, ?string $charset): self
    {
        $handle = $gzip ? @gzopen($path, 'rb') : @fopen($path, 'rb');
        if ($handle === false) {
            throw new ApiException(422, 'The file to import cannot be read.');
        }
        $escape = $copy->escaped === $copy->enclosed ? '' : $copy->escaped;
        $null = (string) $copy->null;
        $first = null;
        $width = 0;
        /** @var list<array<string, true>> $possible per column, the types its values all fit */
        $possible = [];
        $valued = [];
        try {
            while (true) {
                $line = $gzip ? self::gzLine($handle) : fgets($handle);
                if ($line === false) {
                    break;
                }
                // A quoted value may hold line breaks: read on until the quotes close.
                while (self::inQuotes($line, $copy->enclosed, $escape)) {
                    $more = $gzip ? self::gzLine($handle) : fgets($handle);
                    if ($more === false) {
                        break;
                    }
                    $line .= $more;
                }
                if ($first === null && trim($line, "\r\n") === '') {
                    continue;
                }
                $row = str_getcsv(rtrim($line, "\r\n"), $copy->separator, $copy->enclosed, $escape);
                $width = max($width, count($row));
                if ($first === null) {
                    $first = $row;
                    if ($copy->header !== 'none') {
                        continue;
                    }
                }
                if (!$guessTypes) {
                    if ($copy->header !== 'none') {
                        break;
                    }
                    continue;
                }
                foreach ($row as $i => $value) {
                    $possible[$i] ??= array_fill_keys(array_keys(self::TYPES), true);
                    // COPY's NULL string is no value; with FORCE_NULL (see forceNull) neither is
                    // a quoted empty one, which str_getcsv cannot tell from an unquoted one.
                    if ($value === null || $value === $null) {
                        continue;
                    }
                    $value = trim($value);
                    $valued[$i] = true;
                    foreach (array_keys($possible[$i]) as $type) {
                        if (preg_match(self::TYPES[$type], $value) !== 1 || ($type === 'integer' && abs((int) $value) > 2147483647)) {
                            unset($possible[$i][$type]);
                        }
                    }
                }
            }
        } finally {
            $gzip ? gzclose($handle) : fclose($handle);
        }
        if ($first === null) {
            throw new ApiException(422, 'The file is empty: there is no line to take the columns from.');
        }

        if ($copy->header !== 'none') {
            $header = $first;
            if ($charset !== null && strtoupper($charset) !== 'UTF8' && function_exists('mb_convert_encoding')) {
                $header = array_map(static fn (?string $h): string => (string) @mb_convert_encoding((string) $h, 'UTF-8', $charset), $header);
            }
            $columns = [];
            foreach (range(0, $width - 1) as $i) {
                $name = trim((string) ($header[$i] ?? ''));
                if ($i === 0) {
                    $name = preg_replace('/^\xEF\xBB\xBF/', '', $name) ?? $name;
                }
                // PostgreSQL keeps the first 63 bytes of a name.
                $columns[] = $name === '' ? 'COL ' . ($i + 1) : mb_strcut($name, 0, 63, 'UTF-8');
            }
        } else {
            $columns = array_map(static fn (int $i): string => 'COL ' . ($i + 1), range(0, $width - 1));
        }
        $seen = [];
        foreach ($columns as &$name) {
            $base = $name;
            for ($n = 2; isset($seen[$name]); $n++) {
                $name = mb_strcut($base, 0, 63 - strlen('_' . $n), 'UTF-8') . '_' . $n;
            }
            $seen[$name] = true;
        }
        unset($name);

        $types = [];
        foreach (array_keys($columns) as $i) {
            // A column with no value at all stays text.
            $fits = $guessTypes && isset($valued[$i]) ? array_key_first($possible[$i]) : null;
            $types[] = $fits ?? 'text';
        }

        return new self($schema, $table, $columns, $types);
    }

    /**
     * The columns that are not text, for COPY's FORCE_NULL: a quoted empty value in one cannot
     * be loaded as the empty string, and is NULL like an unquoted one.
     *
     * @return list<string>
     */
    public function forceNull(): array
    {
        return array_values(array_intersect_key($this->columns, array_filter($this->types, static fn (string $t): bool => $t !== 'text')));
    }

    /** CREATE TABLE schema.table (column type, …). */
    public function createSql(): string
    {
        $columns = array_map(static fn (string $name, string $type): string => Quoting::ident($name) . ' ' . $type, $this->columns, $this->types);

        return sprintf('CREATE TABLE %s (%s)', Quoting::ident($this->schema, $this->table), implode(', ', $columns));
    }

    /**
     * The columns as CopyCommand reads a table's.
     *
     * @return list<array{name: string, generated: bool, identity: string}>
     */
    public function relationColumns(): array
    {
        return array_map(static fn (string $name): array => ['name' => $name, 'generated' => false, 'identity' => ''], $this->columns);
    }

    /**
     * Whether the line ends inside a quoted value: a quote opens or closes one, a doubled quote
     * or an escaped one (the ESCAPE character before it) inside a value does neither.
     */
    private static function inQuotes(string $line, string $quote, string $escape): bool
    {
        $in = false;
        $length = strlen($line);
        for ($i = 0; $i < $length; $i++) {
            $char = $line[$i];
            if ($in && $escape !== '' && $char === $escape && $i + 1 < $length && ($line[$i + 1] === $quote || $line[$i + 1] === $escape)) {
                $i++;
            } elseif ($char === $quote) {
                $in = !$in;
            }
        }

        return $in;
    }

    /** @param resource $handle */
    private static function gzLine($handle): string|false
    {
        $line = gzgets($handle);

        return $line === false || $line === '' ? false : $line;
    }
}
