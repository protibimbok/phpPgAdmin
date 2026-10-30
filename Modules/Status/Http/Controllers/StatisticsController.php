<?php

declare(strict_types=1);

namespace PhpPgAdmin\Modules\Status\Http\Controllers;

use League\Route\Http\Exception\NotFoundException;
use PhpPgAdmin\Core\Database\Connection;
use PhpPgAdmin\Core\Database\ConnectionPool;
use PhpPgAdmin\Core\Database\QueryException;
use PhpPgAdmin\Core\Database\Quoting;
use PhpPgAdmin\Core\Facades\Sql;
use PhpPgAdmin\Core\Http\ApiException;
use Psr\Http\Message\ServerRequestInterface;

/**
 * The PostgreSQL counterparts of phpMyAdmin's Status » Query statistics and All status
 * variables: the top statements of pg_stat_statements (in the database it is installed in,
 * with pg_stat_statements_reset()), and the cumulative counters of pg_stat_database (one
 * database or every one summed), pg_stat_bgwriter and, from PostgreSQL 17, pg_stat_checkpointer.
 */
final class StatisticsController
{
    /** The columns the statements can be sorted by. */
    private const array SORTS = ['calls', 'total_exec_time', 'mean_exec_time', 'rows', 'shared_blks_hit', 'shared_blks_read'];

    /** Statements listed at most. */
    private const int LIMIT = 100;

    /**
     * pg_stat_statements in the chosen database (the maintenance database without one, which
     * lists the statements of every database). When the extension is not there, or its library
     * is not loaded, says so instead, with what is needed to install it.
     *
     * @return array<string, mixed>
     */
    public function queries(ServerRequestInterface $request): array
    {
        $query = $request->getQueryParams();
        $name = (string) ($query['database'] ?? '');
        $sort = in_array($query['sort'] ?? null, self::SORTS, true) ? (string) $query['sort'] : 'total_exec_time';
        $ascending = ($query['order'] ?? '') === 'asc';
        $pool = ConnectionPool::from($request);
        $conn = $name === '' ? $pool->maintenance() : $pool->for($name);
        $extension = $this->extension($conn);
        $loaded = preg_match('/(^|[\s,\/])pg_stat_statements(\.so)?\s*($|,)/', (string) $conn->scalar("SELECT pg_catalog.current_setting('shared_preload_libraries')")) === 1;
        $status = [
            'database' => $conn->database(),
            'all' => $name === '',
            'installed' => $extension !== null,
            'available' => $extension !== null || $conn->scalar("SELECT 1 FROM pg_catalog.pg_available_extensions WHERE name = 'pg_stat_statements'") !== null,
            'loaded' => $loaded,
            'version' => $extension['extversion'] ?? null,
            'schema' => $extension['nspname'] ?? null,
            'sort' => $sort,
            'order' => $ascending ? 'asc' : 'desc',
        ];
        if ($extension === null || !$loaded) {
            return $status;
        }

        $vars = [
            'conn' => $conn,
            'nspname' => $extension['nspname'],
            'did' => $name === '' ? null : (int) $conn->scalar('SELECT oid FROM pg_catalog.pg_database WHERE datname = pg_catalog.current_database()'),
            'sort' => $sort,
            'ascending' => $ascending,
            'limit' => self::LIMIT,
            'has_info' => $conn->scalar('SELECT pg_catalog.to_regclass($1)', [Quoting::ident($extension['nspname']) . '.pg_stat_statements_info']) !== null,
        ];
        try {
            $totals = $conn->row(Sql::render('statistics', 'statements_totals.sql', $vars, $conn->version())) ?? [];
            $rows = $conn->rows(Sql::render('statistics', 'statements.sql', $vars, $conn->version()));
        } catch (QueryException $e) {
            // Not allowed to read it, or the library went away: show the server's reason.
            return [...$status, 'error' => $e->getMessage()];
        }

        return [
            ...$status,
            'limit' => self::LIMIT,
            'totals' => [
                'statements' => (int) $totals['statements'],
                'calls' => (int) $totals['calls'],
                'total_exec_time' => (float) $totals['total_exec_time'],
                'rows' => (int) $totals['rows'],
                'stats_reset' => $totals['stats_reset'] === null ? null : (float) $totals['stats_reset'],
                'start_time' => (float) $totals['start_time'],
                'now' => (float) $totals['now'],
            ],
            'statements' => array_map(static fn (array $row): array => [
                'queryid' => $row['queryid'],
                'datname' => $row['datname'],
                'rolname' => $row['rolname'],
                'query' => (string) $row['query'],
                'calls' => (int) $row['calls'],
                'total_exec_time' => (float) $row['total_exec_time'],
                'mean_exec_time' => (float) $row['mean_exec_time'],
                'rows' => (int) $row['rows'],
                'shared_blks_hit' => (int) $row['shared_blks_hit'],
                'shared_blks_read' => (int) $row['shared_blks_read'],
            ], $rows),
        ];
    }

    /**
     * pg_stat_statements_reset(): forget the statistics gathered so far, in the database the
     * extension is installed in.
     *
     * @return array{sql: string}
     */
    public function resetQueries(ServerRequestInterface $request): array
    {
        $name = (string) (((array) $request->getParsedBody())['database'] ?? '');
        $pool = ConnectionPool::from($request);
        $conn = $name === '' ? $pool->maintenance() : $pool->for($name);
        $extension = $this->extension($conn) ?? throw new ApiException(409, sprintf('pg_stat_statements is not installed in the database "%s".', $conn->database()));
        $sql = sprintf('SELECT %s.pg_stat_statements_reset();', Quoting::ident($extension['nspname']));
        $conn->exec($sql);

        return ['sql' => $sql];
    }

    /**
     * The cumulative counters, as phpMyAdmin's status variables: pg_stat_database for the
     * database or summed over all, then the background writer's and the checkpointer's.
     *
     * @return array{groups: list<array{id: string, view: string, rows: list<array{name: string, value: string|null, numeric: bool}>}>}
     */
    public function counters(ServerRequestInterface $request): array
    {
        $name = (string) ($request->getQueryParams()['database'] ?? '');
        $conn = ConnectionPool::from($request)->maintenance();
        if ($name !== '' && $conn->scalar('SELECT 1 FROM pg_catalog.pg_database WHERE datname = $1', [$name]) === null) {
            throw new NotFoundException(sprintf('There is no database "%s".', $name));
        }

        $groups = [['id' => 'database', 'view' => 'pg_stat_database', 'rows' => self::rows($conn->row(Sql::render('statistics', 'database.sql', ['conn' => $conn, 'name' => $name === '' ? null : $name], $conn->version())) ?? [])]];
        $groups[] = ['id' => 'bgwriter', 'view' => 'pg_stat_bgwriter', 'rows' => self::rows($conn->row('SELECT * FROM pg_catalog.pg_stat_bgwriter') ?? [])];
        // PostgreSQL 17 moved the checkpoint counters out of pg_stat_bgwriter.
        if ($conn->version() >= 170000) {
            $groups[] = ['id' => 'checkpointer', 'view' => 'pg_stat_checkpointer', 'rows' => self::rows($conn->row('SELECT * FROM pg_catalog.pg_stat_checkpointer') ?? [])];
        }

        return ['groups' => $groups];
    }

    /**
     * @param array<string, mixed> $row
     * @return list<array{name: string, value: string|null, numeric: bool}>
     */
    private static function rows(array $row): array
    {
        $rows = [];
        foreach ($row as $column => $value) {
            $text = $value === null ? null : (is_bool($value) ? ($value ? 'true' : 'false') : (string) $value);
            $rows[] = ['name' => (string) $column, 'value' => $text, 'numeric' => $text !== null && is_numeric($text)];
        }

        return $rows;
    }

    /** @return array{nspname: string, extversion: string}|null where pg_stat_statements is installed in the database */
    private function extension(Connection $conn): ?array
    {
        $row = $conn->row("SELECT n.nspname, e.extversion FROM pg_catalog.pg_extension e JOIN pg_catalog.pg_namespace n ON n.oid = e.extnamespace WHERE e.extname = 'pg_stat_statements'");

        return $row === null ? null : ['nspname' => (string) $row['nspname'], 'extversion' => (string) $row['extversion']];
    }
}
