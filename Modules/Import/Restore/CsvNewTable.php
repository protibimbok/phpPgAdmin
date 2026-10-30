<?php

declare(strict_types=1);

namespace PhpPgAdmin\Modules\Import\Restore;

use PhpPgAdmin\Core\Database\Quoting;
use PhpPgAdmin\Core\Http\ApiException;

/**
 * phpMyAdmin's CSV import into a new table, at a database's or schema's scope: the columns come
 * from the file's first line when it holds the names (else "COL 1", "COL 2"…, as phpMyAdmin
 * names them), their types are guessed from the first rows (integer, bigint, numeric, boolean,
 * date, timestamp, else text) or all text, and CREATE TABLE runs in the same transaction as
 * the COPY that loads the rows.
 */
final readonly class CsvNewTable
{
    /** How many rows the types are guessed from. */
    private const int SAMPLE = 1000;

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

    /** Reads the file's first line and sample rows; the table to create. */
    public static function read(string $path, bool $gzip, CopyImport $copy, string $schema, string $table, bool $guessTypes, ?string $charset): self
    {
        $handle = $gzip ? @gzopen($path, 'rb') : @fopen($path, 'rb');
        if ($handle === false) {
            throw new ApiException(422, 'The file to import cannot be read.');
        }
        $escape = $copy->escaped === $copy->enclosed ? '' : $copy->escaped;
        $rows = [];
        try {
            while (count($rows) < self::SAMPLE + 1) {
                $line = $gzip ? self::gzLine($handle) : fgets($handle);
                if ($line === false) {
                    break;
                }
                // A quoted value may hold line breaks: read on until the quotes balance.
                while (substr_count($line, $copy->enclosed) % 2 === 1) {
                    $more = $gzip ? self::gzLine($handle) : fgets($handle);
                    if ($more === false) {
                        break;
                    }
                    $line .= $more;
                }
                if (trim($line, "\r\n") === '' && $rows === []) {
                    continue;
                }
                $rows[] = str_getcsv(rtrim($line, "\r\n"), $copy->separator, $copy->enclosed, $escape);
            }
        } finally {
            $gzip ? gzclose($handle) : fclose($handle);
        }
        if ($rows === []) {
            throw new ApiException(422, 'The file is empty: there is no line to take the columns from.');
        }

        $width = max(array_map('count', $rows));
        if ($copy->header !== 'none') {
            $header = array_shift($rows);
            if ($charset !== null && strtoupper($charset) !== 'UTF8' && function_exists('mb_convert_encoding')) {
                $header = array_map(static fn (?string $h): string => (string) @mb_convert_encoding((string) $h, 'UTF-8', $charset), $header);
            }
            $columns = [];
            foreach (range(0, $width - 1) as $i) {
                $name = trim((string) ($header[$i] ?? ''));
                if ($i === 0) {
                    $name = preg_replace('/^\xEF\xBB\xBF/', '', $name) ?? $name;
                }
                $columns[] = $name === '' ? 'COL ' . ($i + 1) : mb_substr($name, 0, 63);
            }
        } else {
            $columns = array_map(static fn (int $i): string => 'COL ' . ($i + 1), range(0, $width - 1));
        }
        $seen = [];
        foreach ($columns as &$name) {
            $base = $name;
            for ($n = 2; isset($seen[$name]); $n++) {
                $name = mb_substr($base, 0, 60) . '_' . $n;
            }
            $seen[$name] = true;
        }
        unset($name);

        $types = [];
        foreach (array_keys($columns) as $i) {
            $types[] = $guessTypes ? self::guess(array_map(static fn (array $row): ?string => $row[$i] ?? null, $rows), (string) $copy->null) : 'text';
        }

        return new self($schema, $table, $columns, $types);
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
     * The narrowest type every value fits, the NULL string and empty values left out.
     *
     * @param list<string|null> $values
     */
    private static function guess(array $values, string $null): string
    {
        $values = array_values(array_filter($values, static fn (?string $v): bool => $v !== null && $v !== '' && $v !== $null));
        if ($values === []) {
            return 'text';
        }
        $all = static fn (string $pattern): bool => array_filter($values, static fn (string $v): bool => preg_match($pattern, trim($v)) !== 1) === [];
        if ($all('/^[+-]?\d{1,18}$/')) {
            $fitsInteger = array_filter($values, static fn (string $v): bool => abs((int) trim($v)) > 2147483647) === [];

            return $fitsInteger ? 'integer' : 'bigint';
        }
        if ($all('/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/')) {
            return 'numeric';
        }
        if ($all('/^(true|false|t|f)$/i')) {
            return 'boolean';
        }
        if ($all('/^\d{4}-\d{2}-\d{2}$/')) {
            return 'date';
        }
        if ($all('/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/')) {
            return 'timestamp without time zone';
        }
        if ($all('/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}(:?\d{2})?)$/')) {
            return 'timestamp with time zone';
        }

        return 'text';
    }

    /** @param resource $handle */
    private static function gzLine($handle): string|false
    {
        $line = gzgets($handle);

        return $line === false || $line === '' ? false : $line;
    }
}
