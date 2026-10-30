<?php

declare(strict_types=1);

namespace PhpPgAdmin\Modules\Export\Dump;

use League\Route\Http\Exception\BadRequestException;

/**
 * What the Export page asks for, checked: the scope (the server, a database, a schema, a
 * relation), the format and output, what to select, and pg_dump's content options or the CSV
 * options. A field
 * left out takes pg_dump's own default, so the page's "Quick" method sends little more than
 * the scope and the format.
 */
final readonly class ExportRequest
{
    public const array SCOPES = ['server', 'database', 'schema', 'table'];

    public const array FORMATS = ['plain', 'custom', 'tar', 'csv', 'excel', 'tsv', 'html', 'xml'];

    /** The formats written here from a cursor (RowStream), for one relation's rows. */
    public const array ROW_FORMATS = ['html', 'xml'];

    public const array COMPRESSIONS = ['none', 'gzip'];

    /**
     * The options that leave something out when switched off, each with the flag that does it.
     * They are on unless the request turns them off.
     */
    public const array INCLUDE_FLAGS = [
        'owner' => '--no-owner',
        'privileges' => '--no-privileges',
        'comments' => '--no-comments',
        'tablespaces' => '--no-tablespaces',
        'publications' => '--no-publications',
        'subscriptions' => '--no-subscriptions',
        'security_labels' => '--no-security-labels',
        'policies' => '--no-policies',
        'unlogged_data' => '--no-unlogged-table-data',
        'role_passwords' => '--no-role-passwords',
    ];

    /** The options that add a flag when switched on; they are off unless the request turns them on. */
    public const array ADD_FLAGS = [
        'create' => '--create',
        'clean' => '--clean',
        'if_exists' => '--if-exists',
        'statistics' => '--statistics',
        'set_session_authorization' => '--use-set-session-authorization',
        'quote_all_identifiers' => '--quote-all-identifiers',
        'disable_dollar_quoting' => '--disable-dollar-quoting',
        'serializable_deferrable' => '--serializable-deferrable',
        'disable_triggers' => '--disable-triggers',
        'load_via_partition_root' => '--load-via-partition-root',
        'on_conflict_do_nothing' => '--on-conflict-do-nothing',
    ];

    /**
     * @param list<string> $databases the databases a server export keeps; null for all of them
     * @param list<string>|null $structure the schemas (database scope) or relations (schema scope) whose definitions are exported; null for all
     * @param list<string>|null $data the same for their rows
     * @param array<string, bool> $flags the INCLUDE_FLAGS and ADD_FLAGS options the request set
     */
    public function __construct(
        public string $scope,
        public ?string $database,
        public ?string $schema,
        public ?string $table,
        public string $format,
        public bool $asText,
        public string $filenameTemplate,
        public ?string $encoding,
        public string $compression,
        public ?float $maxSize,
        public string $headerComment,
        public ?array $databases,
        public ?array $structure,
        public ?array $data,
        public string $contents,
        public string $globals,
        public bool $largeObjects,
        public string $dataStyle,
        public string $insertSyntax,
        public int $rowsPerInsert,
        public array $flags,
        public ?CsvOptions $csv = null,
        public bool $htmlColumns = true,
        public string $htmlNull = 'NULL',
    ) {
    }

    /** @param array<string, mixed> $input */
    public static function fromArray(array $input): self
    {
        $name = static function (string $key) use ($input): ?string {
            $value = $input[$key] ?? null;

            return is_string($value) && $value !== '' ? $value : null;
        };
        $database = $name('database');
        $schema = $name('schema');
        $table = $name('table');
        $scope = match (true) {
            $database === null => 'server',
            $schema === null => 'database',
            $table === null => 'schema',
            default => 'table',
        };

        $format = self::choice($input, 'format', self::FORMATS, 'plain');
        if ($scope === 'server' && $format !== 'plain') {
            throw new BadRequestException('pg_dumpall writes plain SQL only.');
        }
        if (in_array($format, self::ROW_FORMATS, true) && $scope !== 'table') {
            throw new BadRequestException('HTML and XML exports are of one table or view.');
        }

        $maxSize = $input['max_size'] ?? null;
        if ($maxSize === '' || $maxSize === null) {
            $maxSize = null;
        } elseif (!is_numeric($maxSize) || (float) $maxSize < 0) {
            throw new BadRequestException('"Skip tables larger than" takes a size in MiB.');
        }

        $rows = $input['rows_per_insert'] ?? 100;
        if (!is_numeric($rows) || (int) $rows < 1) {
            throw new BadRequestException('The rows per INSERT statement are a number from 1.');
        }

        $encoding = $name('encoding');
        if ($encoding !== null && preg_match('/^[A-Za-z0-9_]+$/', $encoding) !== 1) {
            throw new BadRequestException(sprintf('"%s" is not an encoding.', $encoding));
        }

        $flags = [];
        foreach ([...array_keys(self::INCLUDE_FLAGS), ...array_keys(self::ADD_FLAGS)] as $flag) {
            if (array_key_exists($flag, $input)) {
                $flags[$flag] = filter_var($input[$flag], FILTER_VALIDATE_BOOL);
            }
        }

        return new self(
            scope: $scope,
            database: $database,
            schema: $schema,
            table: $table,
            format: $format,
            asText: ($input['output'] ?? 'file') === 'text',
            filenameTemplate: trim((string) ($input['filename_template'] ?? '')),
            encoding: $encoding,
            compression: self::choice($input, 'compression', self::COMPRESSIONS, 'none'),
            maxSize: $maxSize === null ? null : (float) $maxSize,
            headerComment: (string) ($input['header_comment'] ?? ''),
            databases: self::names($input, 'databases'),
            structure: self::names($input, 'structure'),
            data: self::names($input, 'data'),
            contents: self::choice($input, 'contents', ['both', 'structure', 'data'], 'both'),
            globals: self::choice($input, 'globals', ['all', 'globals', 'roles', 'tablespaces'], 'all'),
            largeObjects: filter_var($input['large_objects'] ?? true, FILTER_VALIDATE_BOOL),
            dataStyle: self::choice($input, 'data_style', ['copy', 'insert'], 'copy'),
            insertSyntax: self::choice($input, 'insert_syntax', ['neither', 'columns', 'multi', 'both'], 'both'),
            rowsPerInsert: (int) $rows,
            flags: $flags,
            csv: in_array($format, ['csv', 'excel', 'tsv'], true) ? CsvOptions::fromArray($input, $format) : null,
            htmlColumns: filter_var($input['htmlword_columns'] ?? true, FILTER_VALIDATE_BOOL),
            htmlNull: is_string($input['htmlword_null'] ?? null) ? $input['htmlword_null'] : 'NULL',
        );
    }

    /** Whether the option is on: as the request set it, or its default. */
    public function flag(string $name): bool
    {
        return $this->flags[$name] ?? array_key_exists($name, self::INCLUDE_FLAGS);
    }

    /** Whether the rows are read through a cursor here: HTML and XML. */
    public function isRowFormat(): bool
    {
        return in_array($this->format, self::ROW_FORMATS, true);
    }

    public function isArchive(): bool
    {
        return $this->format === 'custom' || $this->format === 'tar';
    }

    /** @param list<string> $allowed */
    private static function choice(array $input, string $key, array $allowed, string $default): string
    {
        $value = $input[$key] ?? $default;
        if (!is_string($value) || !in_array($value, $allowed, true)) {
            throw new BadRequestException(sprintf('"%s" takes one of %s.', $key, implode(', ', $allowed)));
        }

        return $value;
    }

    /** @return list<string>|null */
    private static function names(array $input, string $key): ?array
    {
        if (!array_key_exists($key, $input) || $input[$key] === null) {
            return null;
        }
        if (!is_array($input[$key])) {
            throw new BadRequestException(sprintf('"%s" is a list of names.', $key));
        }

        return array_values(array_unique(array_map('strval', array_filter($input[$key], 'is_scalar'))));
    }
}
