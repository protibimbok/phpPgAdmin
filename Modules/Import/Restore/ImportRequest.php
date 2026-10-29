<?php

declare(strict_types=1);

namespace PhpPgAdmin\Modules\Import\Restore;

use League\Route\Http\Exception\BadRequestException;

/**
 * What the Import page asks for, checked: the scope (the server, a database, a schema, a
 * table), the format (SQL run by psql, a pg_dump archive restored by pg_restore, or a table's
 * rows in CSV or COPY's text or binary format, loaded by COPY), the file's character set, and
 * each format's options. A field left out takes its default, as the page shows it.
 */
final readonly class ImportRequest
{
    public const array FORMATS = ['sql', 'archive', ...CopyImport::FORMATS];

    /** pg_restore's options that leave something out when switched off, with the flag that does it. */
    public const array INCLUDE_FLAGS = [
        'owner' => '--no-owner',
        'privileges' => '--no-privileges',
        'tablespaces' => '--no-tablespaces',
        'comments' => '--no-comments',
        'publications' => '--no-publications',
        'subscriptions' => '--no-subscriptions',
        'security_labels' => '--no-security-labels',
        'policies' => '--no-policies',
        'table_access_method' => '--no-table-access-method',
    ];

    /** pg_restore's options that add a flag when switched on. */
    public const array ADD_FLAGS = [
        'clean' => '--clean',
        'if_exists' => '--if-exists',
        'single_transaction' => '--single-transaction',
        'exit_on_error' => '--exit-on-error',
        'disable_triggers' => '--disable-triggers',
        'no_data_for_failed_tables' => '--no-data-for-failed-tables',
        'statistics' => '--statistics',
        'set_session_authorization' => '--use-set-session-authorization',
        'verbose' => '--verbose',
    ];

    /** The defaults of the switches, as the page starts. */
    public const array DEFAULTS = [
        'owner' => true,
        'privileges' => true,
        'tablespaces' => true,
        'comments' => true,
        'publications' => true,
        'subscriptions' => true,
        'security_labels' => true,
        'policies' => true,
        'table_access_method' => true,
        'clean' => false,
        'if_exists' => false,
        'single_transaction' => false,
        'exit_on_error' => false,
        'disable_triggers' => false,
        'no_data_for_failed_tables' => false,
        'statistics' => false,
        'set_session_authorization' => false,
        'verbose' => false,
    ];

    /** @param array<string, bool> $flags */
    public function __construct(
        public string $scope,
        public ?string $database,
        public ?string $schema,
        public ?string $table,
        public string $format,
        public ?string $charset,
        public ?string $localFile,
        public bool $foreignKeyChecks,
        public bool $stopOnError,
        public bool $sqlSingleTransaction,
        public string $contents,
        public int $jobs,
        public array $flags,
        /** The COPY options of a table's rows; null for SQL and archives. */
        public ?CopyImport $copy,
    ) {
    }

    /** @param array<string, mixed> $input */
    public static function fromArray(array $input): self
    {
        $database = self::name($input, 'database');
        $schema = self::name($input, 'schema');
        if ($schema !== null && $database === null) {
            throw new BadRequestException('A schema is imported into within a database.');
        }
        $table = self::name($input, 'table');
        if ($table !== null && $schema === null) {
            throw new BadRequestException('A table is imported into within a schema.');
        }
        $format = (string) ($input['format'] ?? 'sql');
        if (!in_array($format, self::FORMATS, true)) {
            throw new BadRequestException(sprintf('The format "%s" is not one the Import page offers.', $format));
        }
        $copy = in_array($format, CopyImport::FORMATS, true) ? CopyImport::fromArray($input, $format) : null;
        if ($copy !== null && $table === null) {
            throw new BadRequestException('Rows in CSV or COPY\'s formats are imported into a table.');
        }
        $contents = (string) ($input['contents'] ?? 'both');
        if (!in_array($contents, ['both', 'structure', 'data'], true)) {
            throw new BadRequestException('What to restore is "both", "structure" or "data".');
        }
        $jobs = filter_var($input['jobs'] ?? 1, FILTER_VALIDATE_INT, ['options' => ['min_range' => 1, 'max_range' => 64]]);
        if ($jobs === false) {
            throw new BadRequestException('The number of jobs is a whole number from 1 to 64.');
        }
        $charset = self::name($input, 'charset');
        if ($charset !== null && preg_match('/^[A-Za-z0-9_]+$/', $charset) !== 1) {
            throw new BadRequestException(sprintf('"%s" is not a character set.', $charset));
        }

        $flags = [];
        foreach (self::DEFAULTS as $name => $default) {
            $flags[$name] = array_key_exists($name, $input) ? (bool) $input[$name] : $default;
        }
        if ($jobs > 1 && $flags['single_transaction']) {
            throw new BadRequestException('pg_restore cannot run parallel jobs in a single transaction.');
        }

        return new self(
            $database === null ? 'server' : ($schema === null ? 'database' : ($table === null ? 'schema' : 'table')),
            $database,
            $schema,
            $table,
            $format,
            $charset,
            self::name($input, 'local_file'),
            (bool) ($input['fk_checks'] ?? true),
            (bool) ($input['stop_on_error'] ?? true),
            (bool) ($input['sql_single_transaction'] ?? false),
            $contents,
            $jobs,
            $flags,
            $copy,
        );
    }

    public function flag(string $name): bool
    {
        return $this->flags[$name] ?? false;
    }

    private static function name(array $input, string $key): ?string
    {
        $value = $input[$key] ?? null;

        return is_string($value) && $value !== '' ? $value : null;
    }
}
