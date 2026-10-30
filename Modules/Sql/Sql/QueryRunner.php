<?php

declare(strict_types=1);

namespace PhpPgAdmin\Modules\Sql\Sql;

use PhpPgAdmin\Core\Database\Connection;
use PhpPgAdmin\Core\Database\QueryException;
use PhpPgAdmin\Core\Database\Result;
use PhpPgAdmin\Modules\Sql\Storage\QueryHistory;
use PhpPgAdmin\Modules\Sql\Storage\RunningQueries;

/**
 * Runs a batch the way phpMyAdmin's SQL page does: statement by statement, stopping at the
 * first failure, with a lone row-returning statement paged (and ordered) by wrapping it in a
 * subquery, so a table's columns keep their origin and the rows can still be edited.
 *
 * Values travel as the server's text, except booleans, which read "true" and "false".
 */
final class QueryRunner
{
    private const int OID_BOOL = 16;

    /** The alias of the paging wrapper; a name no real column is likely to carry. */
    private const string WRAPPER = '_pga';

    /** The savepoint a batch run as one transaction sits on inside an open transaction. */
    private const string BATCH = '_pga_batch';

    /** Whether the run is inside a transaction, where a failed helper query must not abort it. */
    private bool $guarded = false;

    /** What the paging wrapper puts before the statement. */
    private const string WRAPPER_PREFIX = "SELECT * FROM (\n";

    /** What a WITH holding an INSERT, UPDATE, DELETE or MERGE says when it is put in a subquery. */
    private const string FEATURE_NOT_SUPPORTED = '0A000';

    /**
     * @param array{sql: string, delimiter?: string, request_id?: string|null, limit?: int|null, offset?: int, count?: bool, order?: list<array{name: string, desc?: bool}>, transaction?: bool, rollback?: bool, statement_timeout_ms?: int} $options
     */
    public function __construct(
        private readonly Connection $conn,
        private readonly array $options,
        private readonly ?QueryHistory $history = null,
        private readonly ?RunningQueries $running = null,
    ) {
    }

    /**
     * @return array{results: list<array<string, mixed>>, source: array<string, mixed>|null, backend_pid: int, rolled_back: bool}
     */
    public function run(): array
    {
        $statements = Splitter::split($this->options['sql'], (string) ($this->options['delimiter'] ?? ';'));
        if ($statements === []) {
            throw QueryException::fromMessage('Empty query.', $this->options['sql']);
        }

        $timeout = max(0, (int) ($this->options['statement_timeout_ms'] ?? 0));
        if ($timeout > 0) {
            $this->conn->exec(sprintf('SET statement_timeout = %d', $timeout));
        }

        $requestId = (string) ($this->options['request_id'] ?? '');
        if ($requestId !== '' && $this->running !== null) {
            $this->running->register($requestId, $this->conn->database(), $this->conn->backendPid());
        }

        try {
            return $this->runStatements($statements);
        } finally {
            if ($requestId !== '' && $this->running !== null) {
                $this->running->unregister($requestId);
            }
        }
    }

    /**
     * @param list<Statement> $statements
     * @return array{results: list<array<string, mixed>>, source: array<string, mixed>|null, backend_pid: int, rolled_back: bool}
     */
    private function runStatements(array $statements): array
    {
        $rollback = (bool) ($this->options['rollback'] ?? false);
        $transaction = $rollback || (bool) ($this->options['transaction'] ?? false);
        // Only a lone statement is paged: a batch's SELECTs show what they return, up to the limit.
        $pageable = count($statements) === 1 && Splitter::isPageable($statements[0]->sql);

        // pgAdmin's "Auto commit" off: a run outside a transaction opens one and leaves it open
        // for the query tool's Commit and Rollback. Only a query tool session's connection
        // outlives the request, so only it can be inside a transaction when a run starts; the
        // batch options then work on a savepoint, leaving the user's transaction as it was.
        $autocommit = (bool) ($this->options['autocommit'] ?? true);
        $status = $this->conn->transactionStatus();
        $open = $status === 'intrans' || $status === 'inerror';
        $savepoint = false;
        $began = false;
        if ($transaction || !$autocommit) {
            if (!$open) {
                $this->conn->exec('BEGIN');
                $began = true;
            } elseif ($transaction) {
                $this->conn->exec('SAVEPOINT ' . self::BATCH);
                $savepoint = true;
            }
        }
        // Inside a transaction a failed attempt at paging would abort it: savepoints guard them.
        $this->guarded = $transaction || $open || $began;

        $results = [];
        $source = null;
        $rolledBack = false;

        foreach ($statements as $statement) {
            $result = $this->runStatement($statement, $pageable, $this->guarded);
            $results[] = $result;

            if ($result['kind'] === 'error') {
                if ($transaction) {
                    $this->undoBatch($savepoint);
                    $rolledBack = true;
                }
                break;
            }

            if ($result['kind'] === 'rows' && $result['source'] !== null) {
                $source = $result['source'];
            }
        }

        if ($transaction && !$rolledBack) {
            if ($rollback) {
                $this->undoBatch($savepoint);
                $rolledBack = true;
            } elseif ($savepoint) {
                $this->conn->exec('RELEASE SAVEPOINT ' . self::BATCH);
            } elseif ($autocommit) {
                $this->conn->exec('COMMIT');
            }
        }

        foreach ($results as &$result) {
            unset($result['source']);
        }
        unset($result);

        return ['results' => $results, 'source' => $source, 'backend_pid' => $this->conn->backendPid(), 'rolled_back' => $rolledBack, 'transaction' => $this->conn->transactionStatus()];
    }

    /** @return array<string, mixed> */
    private function runStatement(Statement $statement, bool $pageable, bool $transaction): array
    {
        $limit = $this->options['limit'] ?? null;
        $limit = $limit === null || (int) $limit <= 0 ? null : (int) $limit;
        $offset = max(0, (int) ($this->options['offset'] ?? 0));
        $order = $pageable ? $this->orderClause() : '';
        $wrapped = $pageable && ($limit !== null || $order !== '' || $offset > 0);
        // Whether the statement may be run again on its own for another page or order: in a
        // batch too, where paging runs just that statement, never the batch.
        $pagesAlone = Splitter::isPageable($statement->sql);

        $startedAt = gmdate('Y-m-d\TH:i:s\Z');
        $started = hrtime(true);
        $sliced = false;
        // Whether the statement that failed was the paging wrapper, whose error position counts
        // the wrapper's own prefix.
        $inWrapper = false;

        try {
            if (!$wrapped) {
                $result = $this->conn->query($statement->sql);
            } else {
                // Inside a transaction a failed attempt would abort it; a savepoint keeps it usable.
                if ($transaction) {
                    $this->conn->exec('SAVEPOINT ' . self::WRAPPER);
                }
                try {
                    $result = $this->conn->query($this->wrap($statement->sql, $order, $limit, $offset));
                } catch (QueryException $e) {
                    if (!self::cannotWrap($e, $order !== '')) {
                        // The statement's own failure: the transaction is left failed, as it
                        // would be had the statement run as written.
                        $inWrapper = true;
                        throw $e;
                    }
                    if ($transaction) {
                        $this->conn->exec('ROLLBACK TO SAVEPOINT ' . self::WRAPPER);
                    }
                    // The statement cannot be a subquery after all: run it as written and page in memory.
                    $result = $this->conn->query($statement->sql);
                    $sliced = true;
                    // A data-modifying WITH ran: paging it again would run it again, so it shows all its rows.
                    if ($e->sqlstate === self::FEATURE_NOT_SUPPORTED) {
                        $pagesAlone = false;
                        $limit = null;
                        $offset = 0;
                    }
                }
                if ($transaction) {
                    $this->conn->exec('RELEASE SAVEPOINT ' . self::WRAPPER);
                }
            }
        } catch (QueryException $e) {
            $duration = (hrtime(true) - $started) / 1e6;
            $this->history?->record($this->conn->database(), $statement->sql, 'error', null, $duration, $e->getMessage(), $startedAt);

            $error = $e->toArray();
            if (isset($error['position']) && $inWrapper) {
                $inside = $error['position'] - mb_strlen(self::WRAPPER_PREFIX);
                if ($inside >= 1 && $inside <= mb_strlen($statement->sql) + 1) {
                    $error['position'] = $inside;
                } else {
                    unset($error['position']);
                }
            }

            return [
                'sql' => $statement->sql,
                'line' => $statement->line,
                // Where the statement starts in the batch, in UTF-16 code units as the editor
                // counts, so the client can mark the error position in what was typed.
                'start' => self::utf16Length(substr($this->options['sql'], 0, $statement->offset)),
                'kind' => 'error',
                'duration_ms' => $duration,
                'error' => $error,
                'notices' => [],
                'source' => null,
            ];
        }

        $duration = (hrtime(true) - $started) / 1e6;

        if (!$result->hasRows()) {
            $this->history?->record($this->conn->database(), $statement->sql, 'success', $result->affectedRows(), $duration, $result->commandTag(), $startedAt);

            return [
                'sql' => $statement->sql,
                'line' => $statement->line,
                'kind' => 'command',
                'affected_rows' => $result->affectedRows(),
                'command_tag' => $result->commandTag(),
                'duration_ms' => $duration,
                'notices' => $result->notices(),
                'source' => null,
            ];
        }

        $described = ColumnMetadata::describe($this->conn, $result->columns());
        $rows = $this->textRows($result);
        $total = null;

        if ($sliced) {
            $total = count($rows);
            $rows = $limit === null ? array_slice($rows, $offset) : array_slice($rows, $offset, $limit);
            $hasMore = $limit !== null && $offset + count($rows) < $total;
        } elseif ($wrapped && $limit !== null) {
            // One row more than the page was asked for, to know whether a next page exists.
            $hasMore = count($rows) > $limit;
            if ($hasMore) {
                array_pop($rows);
            }
            $total = $hasMore ? $this->count($statement->sql) : $offset + count($rows);
        } else {
            $hasMore = false;
            $total = $offset + count($rows);
        }

        $this->history?->record($this->conn->database(), $statement->sql, 'success', count($rows), $duration, $result->commandTag(), $startedAt);

        return [
            'sql' => $statement->sql,
            'line' => $statement->line,
            'kind' => 'rows',
            'columns' => $described['columns'],
            'rows' => $rows,
            'row_count' => count($rows),
            'total_rows' => $total,
            'offset' => $wrapped || $sliced ? $offset : 0,
            'limit' => $wrapped || $sliced ? $limit : null,
            'has_more' => $hasMore,
            'pageable' => $pagesAlone,
            'command_tag' => $result->commandTag(),
            'duration_ms' => $duration,
            'notices' => $result->notices(),
            'source' => $described['source'],
        ];
    }

    /**
     * True when the wrapped statement failed because of the wrapper, as the server rejects it
     * while parsing, before anything ran: a syntax error, a data-modifying WITH in a subquery,
     * or (with an order) a column name the ORDER BY cannot pick out. Any other failure, a
     * cancel or an error at run time, is the statement's own and is not run again.
     */
    private static function cannotWrap(QueryException $e, bool $ordered): bool
    {
        return match ($e->sqlstate) {
            '42601', self::FEATURE_NOT_SUPPORTED => true,
            // ambiguous_column, undefined_column
            '42702', '42703' => $ordered,
            default => false,
        };
    }

    private function wrap(string $sql, string $order, ?int $limit, int $offset): string
    {
        $wrapped = sprintf("%s%s\n) %s", self::WRAPPER_PREFIX, $sql, self::WRAPPER);
        if ($order !== '') {
            $wrapped .= ' ORDER BY ' . $order;
        }
        if ($limit !== null) {
            $wrapped .= sprintf(' LIMIT %d', $limit + 1);
        }
        if ($offset > 0) {
            $wrapped .= sprintf(' OFFSET %d', $offset);
        }

        return $wrapped;
    }

    /** The ORDER BY list from the "order" option, each column quoted; "" when there is none. */
    private function orderClause(): string
    {
        $parts = [];
        foreach ((array) ($this->options['order'] ?? []) as $item) {
            if (!is_array($item) || !isset($item['name']) || (string) $item['name'] === '') {
                continue;
            }
            $parts[] = $this->conn->escapeIdentifier((string) $item['name']) . (!empty($item['desc']) ? ' DESC' : ' ASC');
        }

        return implode(', ', $parts);
    }

    /** The number of rows the statement returns in all, or null when counting fails. */
    private function count(string $sql): ?int
    {
        if (!($this->options['count'] ?? true)) {
            return null;
        }

        if ($this->guarded) {
            $this->conn->exec('SAVEPOINT _pga_count');
        }
        try {
            $count = (int) $this->conn->scalar(sprintf("SELECT count(*) FROM (\n%s\n) _c", $sql));
            if ($this->guarded) {
                $this->conn->exec('RELEASE SAVEPOINT _pga_count');
            }

            return $count;
        } catch (QueryException) {
            if ($this->guarded) {
                $this->safeExec('ROLLBACK TO SAVEPOINT _pga_count');
                $this->safeExec('RELEASE SAVEPOINT _pga_count');
            }

            return null;
        }
    }

    /**
     * The rows as text, booleans spelled out.
     *
     * @return list<list<string|null>>
     */
    private function textRows(Result $result): array
    {
        $rows = $result->textRows();
        $bools = [];
        foreach ($result->columns() as $i => $column) {
            if ($column->typeOid === self::OID_BOOL) {
                $bools[] = $i;
            }
        }

        if ($bools !== []) {
            foreach ($rows as &$row) {
                foreach ($bools as $i) {
                    if ($row[$i] !== null) {
                        $row[$i] = $row[$i] === 't' ? 'true' : 'false';
                    }
                }
            }
            unset($row);
        }

        return $rows;
    }

    /** The length of UTF-8 text in UTF-16 code units, which is how JavaScript counts a string. */
    private static function utf16Length(string $text): int
    {
        if ($text === '' || !mb_check_encoding($text, 'UTF-8')) {
            return strlen($text);
        }

        return intdiv(strlen(mb_convert_encoding($text, 'UTF-16LE', 'UTF-8')), 2);
    }

    /** Undo the batch: back to its savepoint inside the user's transaction, else the whole transaction. */
    private function undoBatch(bool $savepoint): void
    {
        if ($savepoint) {
            $this->safeExec('ROLLBACK TO SAVEPOINT ' . self::BATCH);
            $this->safeExec('RELEASE SAVEPOINT ' . self::BATCH);
        } else {
            $this->safeExec('ROLLBACK');
        }
    }

    private function safeExec(string $sql): void
    {
        try {
            $this->conn->exec($sql);
        } catch (QueryException) {
            // The connection is in a failed state already; the request closes it.
        }
    }
}
