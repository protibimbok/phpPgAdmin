<?php

declare(strict_types=1);

namespace PhpPgAdmin\Modules\Status\Http\Controllers;

use League\Route\Http\Exception\BadRequestException;
use League\Route\Http\Exception\NotFoundException;
use PhpPgAdmin\Core\Database\Connection;
use PhpPgAdmin\Core\Database\ConnectionPool;
use PhpPgAdmin\Core\Facades\Sql;
use Psr\Http\Message\ServerRequestInterface;

/**
 * The running server, after pgAdmin's dashboard: the sessions in pg_stat_activity (with
 * pg_cancel_backend / pg_terminate_backend), the counters its charts plot, and the totals
 * phpMyAdmin's Status page shows, all through the maintenance connection since the views are
 * server-wide. A "database" query parameter limits activity and charts to one database, as
 * pgAdmin's database dashboard does.
 */
final class StatusController
{
    /** The charts dashboard_stats.sql can answer. */
    private const array CHARTS = ['session_stats', 'tps_stats', 'ti_stats', 'to_stats', 'bio_stats'];

    private const string SERVER = <<<'SQL'
        SELECT pg_catalog.current_setting('server_version') AS version,
               EXTRACT(EPOCH FROM pg_catalog.pg_postmaster_start_time())::float8 AS start_time,
               EXTRACT(EPOCH FROM now() - pg_catalog.pg_postmaster_start_time())::bigint AS uptime,
               pg_catalog.pg_is_in_recovery() AS in_recovery,
               pg_catalog.current_setting('max_connections')::int AS max_connections,
               pg_catalog.current_setting('superuser_reserved_connections')::int AS reserved_connections,
               EXTRACT(EPOCH FROM (SELECT min(stats_reset) FROM pg_catalog.pg_stat_database WHERE stats_reset IS NOT NULL))::float8 AS stats_reset,
               EXTRACT(EPOCH FROM now() - COALESCE((SELECT min(stats_reset) FROM pg_catalog.pg_stat_database WHERE stats_reset IS NOT NULL), pg_catalog.pg_postmaster_start_time()))::bigint AS stats_age
        SQL;

    private const string TOTALS = <<<'SQL'
        SELECT sum(xact_commit)::bigint AS xact_commit, sum(xact_rollback)::bigint AS xact_rollback,
               sum(tup_returned)::bigint AS tup_returned, sum(tup_fetched)::bigint AS tup_fetched,
               sum(tup_inserted)::bigint AS tup_inserted, sum(tup_updated)::bigint AS tup_updated, sum(tup_deleted)::bigint AS tup_deleted,
               sum(blks_read)::bigint AS blks_read, sum(blks_hit)::bigint AS blks_hit,
               sum(temp_files)::bigint AS temp_files, sum(temp_bytes)::bigint AS temp_bytes,
               sum(deadlocks)::bigint AS deadlocks, sum(conflicts)::bigint AS conflicts
        FROM pg_catalog.pg_stat_database
        SQL;

    /**
     * phpMyAdmin's Status » Server: the version, start time and uptime, the cumulative
     * counters of pg_stat_database with how long they have been counting, and the sessions by
     * state against max_connections.
     *
     * @return array{server: array<string, mixed>, totals: array<string, int>, sessions: array<string, int>}
     */
    public function server(ServerRequestInterface $request): array
    {
        $conn = ConnectionPool::from($request)->maintenance();
        $server = $conn->row(self::SERVER) ?? [];
        $server['start_time'] = (float) $server['start_time'];
        $server['stats_reset'] = $server['stats_reset'] === null ? null : (float) $server['stats_reset'];
        $server['uptime'] = (int) $server['uptime'];
        $server['stats_age'] = (int) $server['stats_age'];

        $sessions = [];
        foreach ($conn->rows("SELECT COALESCE(state, backend_type) AS state, count(*)::int AS count FROM pg_catalog.pg_stat_activity WHERE backend_type = 'client backend' GROUP BY 1 ORDER BY 1") as $row) {
            $sessions[(string) $row['state']] = (int) $row['count'];
        }
        $sessions['background'] = (int) $conn->scalar("SELECT count(*) FROM pg_catalog.pg_stat_activity WHERE backend_type <> 'client backend'");

        return [
            'server' => $server,
            'totals' => array_map(intval(...), $conn->row(self::TOTALS) ?? []),
            'sessions' => $sessions,
        ];
    }

    /**
     * pgAdmin's dashboard_stats: the current value of each chart's series, keyed by chart, with
     * the server's clock so the client can turn the cumulative counters into rates.
     *
     * @return array{time: float, charts: array<string, array<string, int>>}
     */
    public function charts(ServerRequestInterface $request): array
    {
        $query = $request->getQueryParams();
        $names = array_values(array_intersect(self::CHARTS, explode(',', (string) ($query['names'] ?? implode(',', self::CHARTS)))));
        if ($names === []) {
            throw new BadRequestException('Name at least one chart: ' . implode(', ', self::CHARTS) . '.');
        }
        $conn = ConnectionPool::from($request)->maintenance();

        $charts = [];
        foreach ($conn->rows(Sql::render('dashboard', 'dashboard_stats.sql', ['did' => $this->did($conn, $query), 'chart_names' => $names, 'conn' => $conn], $conn->version())) as $row) {
            $charts[$row['chart_name']] = array_map(static fn (mixed $value): int => (int) $value, json_decode((string) $row['chart_data'], true, flags: JSON_THROW_ON_ERROR));
        }

        return ['time' => (float) $conn->scalar('SELECT EXTRACT(EPOCH FROM clock_timestamp())'), 'charts' => $charts];
    }

    /**
     * pgAdmin's activity.sql: every backend with its state, wait event, the PIDs blocking it and
     * its query. "active" keeps the sessions running a statement; the session's own backend
     * is flagged so it is not offered for termination.
     *
     * @return array{sessions: list<array<string, mixed>>, own_pid: int}
     */
    public function activity(ServerRequestInterface $request): array
    {
        $query = $request->getQueryParams();
        $conn = ConnectionPool::from($request)->maintenance();
        $rows = $conn->rows(Sql::render('dashboard', 'activity.sql', ['did' => $this->did($conn, $query), 'conn' => $conn], $conn->version()));
        if (($query['active'] ?? '') === '1') {
            $rows = array_values(array_filter($rows, static fn (array $row): bool => $row['state'] === 'active'));
        }

        return [
            'sessions' => array_map(static fn (array $row): array => [...$row, 'pid' => (int) $row['pid'], 'active_since' => (float) $row['active_since']], $rows),
            'own_pid' => (int) $conn->scalar('SELECT pg_catalog.pg_backend_pid()'),
        ];
    }

    /** pg_cancel_backend: stop the statement the session is running. */
    public function cancel(ServerRequestInterface $request, array $args): array
    {
        return $this->signal($request, 'pg_cancel_backend', (int) $args['pid']);
    }

    /** pg_terminate_backend: close the session. */
    public function terminate(ServerRequestInterface $request, array $args): array
    {
        return $this->signal($request, 'pg_terminate_backend', (int) $args['pid']);
    }

    /** @return array{ok: bool, sql: string} false when the backend was gone or not signalled */
    private function signal(ServerRequestInterface $request, string $function, int $pid): array
    {
        $sql = sprintf('SELECT pg_catalog.%s(%d);', $function, $pid);

        return ['ok' => (bool) ConnectionPool::from($request)->maintenance()->scalar($sql), 'sql' => $sql];
    }

    /** @param array<string, mixed> $query */
    private function did(Connection $conn, array $query): ?int
    {
        $name = (string) ($query['database'] ?? '');
        if ($name === '') {
            return null;
        }

        return (int) ($conn->scalar('SELECT oid FROM pg_catalog.pg_database WHERE datname = $1', [$name]) ?? throw new NotFoundException(sprintf('There is no database "%s".', $name)));
    }
}
