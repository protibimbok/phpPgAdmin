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
    public const array SCOPES = ['server', 'database', 'schema', 'table', 'query'];

    public const array FORMATS = ['plain', 'custom', 'tar', 'directory', 'csv', 'excel', 'tsv', 'html', 'xml'];

    /** pg_dump's sections, in the order of a dump. */
    public const array SECTIONS = ['pre-data', 'data', 'post-data'];

    /** The formats written here from a cursor (RowStream), for one relation's rows or a query's. */
    public const array ROW_FORMATS = ['html', 'xml'];

    /** What a query's rows can be exported as: INSERT or COPY statements (plain), COPY's CSV and text, HTML and XML. */
    public const array QUERY_FORMATS = ['plain', 'csv', 'excel', 'tsv', 'html', 'xml'];

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
        'toast_compression' => '--no-toast-compression',
        'table_access_method' => '--no-table-access-method',
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
        'enable_row_security' => '--enable-row-security',
        'verbose' => '--verbose',
    ];

    /**
     * @param list<string> $databases the databases a server export keeps; null for all of them
     * @param list<string>|null $structure the schemas (database scope) or relations (schema scope) whose definitions are exported; null for all
     * @param list<string>|null $data the same for their rows
     * @param array<string, bool> $flags the INCLUDE_FLAGS and ADD_FLAGS options the request set
     * @param list<string>|null $sections the SECTIONS pg_dump dumps; null for all of them
     * @param list<string> $excludeSchemas pg_dump patterns of the schemas a database export leaves out
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
        public ?string $sql = null,
        public int $jobs = 1,
        public ?array $sections = null,
        public array $excludeSchemas = [],
        public ?int $extraFloatDigits = null,
        public ?string $lockWaitTimeout = null,
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
        $sql = trim((string) ($input['sql_query'] ?? ''));
        $scope = match (true) {
            $sql !== '' => 'query',
            $database === null => 'server',
            $schema === null => 'database',
            $table === null => 'schema',
            default => 'table',
        };

        $format = self::choice($input, 'format', self::FORMATS, 'plain');
        if ($scope === 'server' && $format !== 'plain') {
            throw new BadRequestException('pg_dumpall writes plain SQL only.');
        }
        if (in_array($format, self::ROW_FORMATS, true) && $scope !== 'table' && $scope !== 'query') {
            throw new BadRequestException('HTML and XML exports are of one table, view or query.');
        }
        if ($scope === 'query' && !in_array($format, self::QUERY_FORMATS, true)) {
            throw new BadRequestException(sprintf('A query\'s rows are exported as one of %s.', implode(', ', self::QUERY_FORMATS)));
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

        if ($format === 'directory' && ($input['output'] ?? 'file') === 'text') {
            throw new BadRequestException('A directory archive is downloaded as a tar file; it cannot be shown as text.');
        }

        $jobs = $input['jobs'] ?? 1;
        if ($jobs === '' || $jobs === null) {
            $jobs = 1;
        } elseif (!is_numeric($jobs) || (int) $jobs < 1 || (int) $jobs > 64) {
            throw new BadRequestException('The number of jobs is a number from 1 to 64.');
        }

        $sections = self::names($input, 'sections');
        if ($sections !== null) {
            foreach ($sections as $section) {
                if (!in_array($section, self::SECTIONS, true)) {
                    throw new BadRequestException(sprintf('"sections" takes %s.', implode(', ', self::SECTIONS)));
                }
            }
            if ($sections === []) {
                throw new BadRequestException('Select at least one section to dump.');
            }
        }

        $excludeSchemas = $input['exclude_schemas'] ?? [];
        if (is_string($excludeSchemas)) {
            // The page's field: patterns separated by commas or lines.
            $excludeSchemas = preg_split('/[\r\n,]+/', $excludeSchemas) ?: [];
        }
        if (!is_array($excludeSchemas)) {
            throw new BadRequestException('"exclude_schemas" is a list of patterns.');
        }
        $excludeSchemas = array_values(array_unique(array_filter(array_map(static fn (mixed $p): string => trim((string) $p), array_filter($excludeSchemas, 'is_scalar')), static fn (string $p): bool => $p !== '')));

        $floatDigits = $input['extra_float_digits'] ?? null;
        if ($floatDigits === '' || $floatDigits === null) {
            $floatDigits = null;
        } elseif (filter_var($floatDigits, FILTER_VALIDATE_INT, ['options' => ['min_range' => -15, 'max_range' => 3]]) === false) {
            throw new BadRequestException('The extra float digits are a number from -15 to 3.');
        }

        $lockWait = trim((string) ($input['lock_wait_timeout'] ?? ''));
        // A number of milliseconds, or one with a unit, as the lock_timeout setting takes it.
        if ($lockWait !== '' && preg_match('/^\d+(\.\d+)?\s*(us|ms|s|min|h|d)?$/', $lockWait) !== 1) {
            throw new BadRequestException(sprintf('"%s" is not a lock wait timeout: give milliseconds, or a number with us, ms, s, min, h or d.', $lockWait));
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
            contents: $scope === 'query' ? 'data' : self::choice($input, 'contents', ['both', 'structure', 'data'], 'both'),
            globals: self::choice($input, 'globals', ['all', 'globals', 'roles', 'tablespaces'], 'all'),
            largeObjects: filter_var($input['large_objects'] ?? true, FILTER_VALIDATE_BOOL),
            dataStyle: self::choice($input, 'data_style', ['copy', 'insert'], 'copy'),
            insertSyntax: self::choice($input, 'insert_syntax', ['neither', 'columns', 'multi', 'both'], 'both'),
            rowsPerInsert: (int) $rows,
            flags: $flags,
            csv: in_array($format, ['csv', 'excel', 'tsv'], true) ? CsvOptions::fromArray($input, $format) : null,
            htmlColumns: filter_var($input['htmlword_columns'] ?? true, FILTER_VALIDATE_BOOL),
            htmlNull: is_string($input['htmlword_null'] ?? null) ? $input['htmlword_null'] : 'NULL',
            sql: $sql === '' ? null : $sql,
            jobs: (int) $jobs,
            sections: $sections === null || count($sections) === count(self::SECTIONS) ? null : $sections,
            excludeSchemas: $excludeSchemas,
            extraFloatDigits: $floatDigits === null ? null : (int) $floatDigits,
            lockWaitTimeout: $lockWait === '' ? null : $lockWait,
        );
    }

    /** Whether the option is on: as the request set it, or its default. */
    public function flag(string $name): bool
    {
        return $this->flags[$name] ?? array_key_exists($name, self::INCLUDE_FLAGS);
    }

    /** Whether the rows are read through a cursor here: HTML and XML, and a query's INSERT or COPY statements. */
    public function isRowFormat(): bool
    {
        return in_array($this->format, self::ROW_FORMATS, true) || ($this->scope === 'query' && $this->format === 'plain');
    }

    public function isArchive(): bool
    {
        return $this->format === 'custom' || $this->format === 'tar' || $this->format === 'directory';
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
