<?php

declare(strict_types=1);

namespace PhpPgAdmin\Modules\Maintenance\Command;

use League\Route\Http\Exception\BadRequestException;
use PhpPgAdmin\Core\Database\Quoting;

/**
 * The statement of a maintenance run, after pgAdmin's maintenance/sql/command.sql: VACUUM,
 * ANALYZE, REINDEX or CLUSTER on a database or on a schema, with the options the dialog offers
 * and the server has. A switch whose PostgreSQL default is on (TRUNCATE, PROCESS_TOAST,
 * PROCESS_MAIN) is written out only when it is switched off.
 *
 * VACUUM and ANALYZE of a schema name its tables, as neither takes a schema; REINDEX SCHEMA
 * does; CLUSTER is offered on a database only, where it reclusters the tables clustered before.
 */
final readonly class MaintenanceCommand
{
    public const array OPERATIONS = ['VACUUM', 'ANALYZE', 'REINDEX', 'CLUSTER'];

    /** The VACUUM switches, with the server version each needs. */
    private const array VACUUM_SWITCHES = [
        'full' => ['FULL', 0],
        'freeze' => ['FREEZE', 0],
        'analyze' => ['ANALYZE', 0],
        'disable_page_skipping' => ['DISABLE_PAGE_SKIPPING', 0],
        'skip_locked' => ['SKIP_LOCKED', 0],
        'skip_database_stats' => ['SKIP_DATABASE_STATS', 160000],
        'only_database_stats' => ['ONLY_DATABASE_STATS', 160000],
    ];

    /** The VACUUM switches that are on unless switched off. */
    private const array VACUUM_DEFAULT_ON = [
        'truncate' => ['TRUNCATE', 0],
        'process_toast' => ['PROCESS_TOAST', 140000],
        'process_main' => ['PROCESS_MAIN', 160000],
    ];

    /**
     * @param array<string, mixed> $options the dialog's fields
     * @param list<string> $tables a schema's tables, for VACUUM and ANALYZE
     */
    public function __construct(
        private string $operation,
        private array $options,
        private string $database,
        private ?string $schema,
        private array $tables,
        private int $version,
    ) {
        if (!in_array($operation, self::OPERATIONS, true)) {
            throw new BadRequestException(sprintf('"%s" is not VACUUM, ANALYZE, REINDEX or CLUSTER.', $operation));
        }
    }

    public function statement(): string
    {
        return match ($this->operation) {
            'VACUUM' => 'VACUUM' . self::list($this->vacuumOptions()) . $this->relations(),
            'ANALYZE' => 'ANALYZE' . self::list($this->analyzeOptions()) . $this->relations(),
            'REINDEX' => $this->reindex(),
            'CLUSTER' => $this->cluster(),
        };
    }

    /** What the process list calls the run: the operation and its target. */
    public function description(): string
    {
        return $this->operation . ' ' . ($this->schema ?? $this->database);
    }

    /** @return list<string> */
    private function vacuumOptions(): array
    {
        $options = $this->flag('verbose') ? ['VERBOSE'] : [];
        foreach (self::VACUUM_SWITCHES as $key => [$option, $since]) {
            if ($this->flag($key) && $this->has($since, $option)) {
                $options[] = $option;
            }
        }
        foreach (self::VACUUM_DEFAULT_ON as $key => [$option, $since]) {
            if (array_key_exists($key, $this->options) && !$this->flag($key) && $this->has($since, $option)) {
                $options[] = $option . ' false';
            }
        }
        if ($this->flag('full') && $this->flag('disable_page_skipping')) {
            throw new BadRequestException('VACUUM FULL rewrites every page: DISABLE_PAGE_SKIPPING does not go with it.');
        }
        $cleanup = strtoupper((string) ($this->options['index_cleanup'] ?? 'AUTO'));
        if (!in_array($cleanup, ['AUTO', 'ON', 'OFF'], true)) {
            throw new BadRequestException('INDEX_CLEANUP is auto, on or off.');
        }
        if ($cleanup !== 'AUTO') {
            $options[] = 'INDEX_CLEANUP ' . $cleanup;
        }
        $parallel = trim((string) ($this->options['parallel'] ?? ''));
        if ($parallel !== '') {
            if (filter_var($parallel, FILTER_VALIDATE_INT, ['options' => ['min_range' => 0, 'max_range' => 1024]]) === false) {
                throw new BadRequestException('PARALLEL takes a number of workers, 0 to switch parallel vacuum off.');
            }
            if ($this->flag('full')) {
                throw new BadRequestException('VACUUM FULL does not run parallel workers.');
            }
            $options[] = 'PARALLEL ' . (int) $parallel;
        }
        $this->bufferUsageLimit($options);

        return $options;
    }

    /** @return list<string> */
    private function analyzeOptions(): array
    {
        $options = $this->flag('verbose') ? ['VERBOSE'] : [];
        if ($this->flag('skip_locked')) {
            $options[] = 'SKIP_LOCKED';
        }
        $this->bufferUsageLimit($options);

        return $options;
    }

    private function reindex(): string
    {
        $options = $this->flag('verbose') ? ['VERBOSE'] : [];
        $tablespace = trim((string) ($this->options['tablespace'] ?? ''));
        $system = $this->schema === null && $this->flag('system');
        $concurrently = $this->flag('concurrently');
        if ($system && ($concurrently || $tablespace !== '')) {
            throw new BadRequestException('REINDEX SYSTEM rebuilds the catalogs in place: CONCURRENTLY and TABLESPACE do not go with it.');
        }
        if ($tablespace !== '' && $this->has(140000, 'TABLESPACE')) {
            $options[] = 'TABLESPACE ' . Quoting::ident($tablespace);
        }
        $concurrently = $concurrently ? ' CONCURRENTLY' : '';

        return 'REINDEX' . self::list($options) . match (true) {
            $system => ' SYSTEM ' . Quoting::ident($this->database),
            $this->schema !== null => ' SCHEMA' . $concurrently . ' ' . Quoting::ident($this->schema),
            default => ' DATABASE' . $concurrently . ' ' . Quoting::ident($this->database),
        };
    }

    private function cluster(): string
    {
        if ($this->schema !== null) {
            throw new BadRequestException('CLUSTER runs on a table, or on every clustered table of the database; not on a schema.');
        }

        return 'CLUSTER' . ($this->flag('verbose') ? ' VERBOSE' : '');
    }

    /** A schema's tables, as VACUUM and ANALYZE take them; nothing for the whole database. */
    private function relations(): string
    {
        if ($this->schema === null) {
            return '';
        }
        if ($this->tables === []) {
            throw new BadRequestException(sprintf('The schema "%s" has no tables to %s.', $this->schema, strtolower($this->operation)));
        }

        return ' ' . implode(', ', array_map(fn (string $table): string => Quoting::ident($this->schema, $table), $this->tables));
    }

    /** @param list<string> $options */
    private function bufferUsageLimit(array &$options): void
    {
        $limit = trim((string) ($this->options['buffer_usage_limit'] ?? ''));
        if ($limit === '') {
            return;
        }
        if (preg_match('/^\d+\s*(B|kB|MB|GB|TB)?$/', $limit) !== 1) {
            throw new BadRequestException('BUFFER_USAGE_LIMIT is a size such as 256kB or 16MB, or 0.');
        }
        if ($this->has(160000, 'BUFFER_USAGE_LIMIT')) {
            $options[] = 'BUFFER_USAGE_LIMIT ' . Quoting::literal($limit);
        }
    }

    private function flag(string $key): bool
    {
        return filter_var($this->options[$key] ?? false, FILTER_VALIDATE_BOOL);
    }

    /** Whether the server has an option, refused when one asked for it does not. */
    private function has(int $since, string $option): bool
    {
        if ($this->version < $since) {
            throw new BadRequestException(sprintf('%s takes PostgreSQL %d or newer.', $option, intdiv($since, 10000)));
        }

        return true;
    }

    /** @param list<string> $options */
    private static function list(array $options): string
    {
        return $options === [] ? '' : ' (' . implode(', ', $options) . ')';
    }
}
