<?php

declare(strict_types=1);

namespace PhpPgAdmin\Core\Database;

use PgSql\Connection as PgConnection;
use Throwable;

/**
 * One libpq connection to a database, through ext-pgsql. Statements run in autocommit mode
 * unless wrapped in transaction(); a request opens what it needs and closes it when it ends.
 */
final class Connection
{
    private ?int $version = null;

    public function __construct(
        private readonly PgConnection $pg,
        private readonly string $database,
    ) {
    }

    /** The database this connection is to. */
    public function database(): string
    {
        return $this->database;
    }

    /**
     * Run one statement, with $1, $2... bound to $params, and return its result.
     *
     * @param list<scalar|null> $params
     * @throws QueryException
     */
    public function query(string $sql, array $params = []): Result
    {
        $results = $this->execute($sql, $params);

        // A single statement yields a single result; a batch sent without params may yield several.
        return $results[array_key_last($results)];
    }

    /**
     * Run a batch of statements and return one result per statement, in order. The batch stops at
     * the first failing statement, whose error is thrown; the results so far are lost with it,
     * so callers that need them run statements one by one.
     *
     * @return list<Result>
     * @throws QueryException
     */
    public function queryMulti(string $sql): array
    {
        return $this->execute($sql, []);
    }

    /**
     * @param list<scalar|null> $params
     * @return list<array<string, mixed>>
     */
    public function rows(string $sql, array $params = []): array
    {
        return $this->query($sql, $params)->rows();
    }

    /**
     * @param list<scalar|null> $params
     * @return array<string, mixed>|null
     */
    public function row(string $sql, array $params = []): ?array
    {
        return $this->query($sql, $params)->row();
    }

    /** @param list<scalar|null> $params */
    public function scalar(string $sql, array $params = []): mixed
    {
        return $this->query($sql, $params)->scalar();
    }

    /**
     * Run a command and return the rows it affected.
     *
     * @param list<scalar|null> $params
     */
    public function exec(string $sql, array $params = []): int
    {
        return $this->query($sql, $params)->affectedRows();
    }

    /**
     * Run the callback inside a transaction, committing when it returns and rolling back when
     * it throws.
     *
     * @template T
     * @param callable(self): T $callback
     * @return T
     */
    public function transaction(callable $callback): mixed
    {
        $this->exec('BEGIN');
        try {
            $value = $callback($this);
            $this->exec('COMMIT');

            return $value;
        } catch (Throwable $e) {
            try {
                $this->exec('ROLLBACK');
            } catch (Throwable) {
                // The connection is lost; the original failure matters more.
            }
            throw $e;
        }
    }

    /** The server's version as PostgreSQL numbers it: 150004 for 15.4. */
    public function version(): int
    {
        return $this->version ??= (int) $this->scalar('SHOW server_version_num');
    }

    /** The server's version as it prints it: "15.4" or "16beta1". */
    public function versionString(): string
    {
        return (string) pg_parameter_status($this->pg, 'server_version');
    }

    /** The PID of the server process serving this connection, to cancel or inspect it. */
    public function backendPid(): int
    {
        return pg_get_pid($this->pg);
    }

    /** The libpq version of the client, "16.2". */
    public function clientVersion(): string
    {
        return (string) (pg_version($this->pg)['client'] ?? '');
    }

    /** A double-quoted identifier, always quoted, as pg_escape_identifier does. */
    public function escapeIdentifier(string $identifier): string
    {
        return pg_escape_identifier($this->pg, $identifier);
    }

    /** A single-quoted literal that respects the connection's encoding and string settings. */
    public function escapeLiteral(string $literal): string
    {
        return pg_escape_literal($this->pg, $literal);
    }

    /** Ask the server to cancel what this connection is running. */
    public function cancel(): bool
    {
        return pg_cancel_query($this->pg);
    }

    public function close(): void
    {
        pg_close($this->pg);
    }

    /**
     * Send the statement(s) and collect every result, raising the first error. Notices are read
     * after each result so each carries the ones raised while it ran.
     *
     * @param list<scalar|null> $params
     * @return list<Result>
     */
    private function execute(string $sql, array $params): array
    {
        pg_last_notice($this->pg, PGSQL_NOTICE_CLEAR);

        $sent = $params === []
            ? pg_send_query($this->pg, $sql)
            : pg_send_query_params($this->pg, $sql, array_map(self::param(...), $params));

        if ($sent === false) {
            throw QueryException::fromMessage(pg_last_error($this->pg), $sql);
        }

        $results = [];
        $failure = null;

        while (($result = pg_get_result($this->pg)) !== false) {
            $status = pg_result_status($result);

            if ($failure === null && ($status === PGSQL_FATAL_ERROR || $status === PGSQL_BAD_RESPONSE || $status === PGSQL_NONFATAL_ERROR)) {
                $failure = QueryException::fromResult($result, $sql);
                continue;
            }

            if ($failure === null) {
                /** @var list<string>|false $notices */
                $notices = pg_last_notice($this->pg, PGSQL_NOTICE_ALL);
                pg_last_notice($this->pg, PGSQL_NOTICE_CLEAR);

                $results[] = new Result($result, $notices === false ? [] : array_values($notices));
            }
        }

        if ($failure !== null) {
            throw $failure;
        }

        if ($results === []) {
            // Only whitespace or comments were sent: libpq answers with an empty-query result or nothing.
            throw QueryException::fromMessage('Empty query.', $sql);
        }

        return $results;
    }

    /** Bind parameters as libpq expects them: text, or null. */
    private static function param(mixed $value): ?string
    {
        return match (true) {
            $value === null => null,
            is_bool($value) => $value ? 't' : 'f',
            default => (string) $value,
        };
    }
}
