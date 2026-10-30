<?php

declare(strict_types=1);

namespace PhpPgAdmin\Modules\DbObjects\Http\Controllers;

use League\Route\Http\Exception\BadRequestException;
use PhpPgAdmin\Core\Database\Connection;
use PhpPgAdmin\Core\Database\Quoting;
use PhpPgAdmin\Core\Nodes\NodeContext;
use PhpPgAdmin\Core\Nodes\NodeController;

/**
 * pg_cron's jobs, in the database the extension is installed in (cron.database_name): the job
 * scheduling pgAdmin offers through pgAgent, as pg_cron does it. Each job of cron.job (the
 * role's own; a superuser's are all) with its schedule, command, the database and role it runs
 * as, whether it is active, and its last run from cron.job_run_details. A job is made with
 * cron.schedule_in_database(), changed with cron.alter_job() and removed with
 * cron.unschedule(); its "SQL" is the cron.schedule_in_database() call that makes it again.
 * The statistics are its runs, newest first. The type is offered only where pg_cron is
 * installed (NodeDefinition::$extension).
 *
 * The client's data: jobname, schedule (cron syntax, or "n seconds"), command, database,
 * username, active. pg_cron cannot rename a job, so jobname is fixed once it is made.
 */
final class CronJobController extends NodeController
{
    /** The pg_cron version with schedule_in_database(), alter_job() and job_run_details. */
    private const string MIN_VERSION = '1.4';

    private const int RUNS = 50;

    public function list(NodeContext $ctx): array
    {
        $this->check($ctx->conn);
        $last = self::hasRuns($ctx->conn)
            ? ', r.status AS last_status, r.start_time AS last_start, r.end_time AS last_end, r.return_message AS last_message'
            : ', NULL::text AS last_status, NULL::timestamptz AS last_start, NULL::timestamptz AS last_end, NULL::text AS last_message';
        $join = self::hasRuns($ctx->conn)
            ? 'LEFT JOIN LATERAL (SELECT d.status, d.start_time, d.end_time, d.return_message FROM cron.job_run_details d WHERE d.jobid = j.jobid ORDER BY d.start_time DESC NULLS LAST LIMIT 1) r ON true'
            : '';

        return $ctx->conn->rows("SELECT j.jobid AS oid, COALESCE(j.jobname, 'job ' || j.jobid) AS name, j.jobname, j.schedule, j.command, j.database, j.username, j.active{$last} FROM cron.job j {$join} ORDER BY j.jobid");
    }

    public function nodes(NodeContext $ctx): array
    {
        $this->check($ctx->conn);

        return array_map(fn (array $row): array => $this->toNode($ctx, $row), $ctx->conn->rows("SELECT jobid AS oid, COALESCE(jobname, 'job ' || jobid) AS name, schedule, active FROM cron.job ORDER BY jobid"));
    }

    public function node(NodeContext $ctx, int $oid): array
    {
        $row = $ctx->conn->row("SELECT jobid AS oid, COALESCE(jobname, 'job ' || jobid) AS name, schedule, active FROM cron.job WHERE jobid = \$1", [$oid]) ?? throw $this->gone($ctx);

        return $this->toNode($ctx, $row);
    }

    public function properties(NodeContext $ctx, int $oid): array
    {
        $this->check($ctx->conn);

        return $ctx->conn->row("SELECT jobid AS oid, COALESCE(jobname, 'job ' || jobid) AS name, jobname, schedule, command, database, username, active FROM cron.job WHERE jobid = \$1", [$oid]) ?? throw $this->gone($ctx);
    }

    public function create(NodeContext $ctx, array $data): array
    {
        $this->check($ctx->conn);
        $job = self::input($ctx, $data, null);
        $oid = (int) $ctx->conn->scalar('SELECT cron.schedule_in_database($1, $2, $3, $4, $5, $6)', [$job['jobname'], $job['schedule'], $job['command'], $job['database'], $job['username'], $job['active'] ? 't' : 'f']);

        return $this->node($ctx, $oid);
    }

    public function update(NodeContext $ctx, int $oid, array $data): array
    {
        $this->check($ctx->conn);
        $job = self::input($ctx, $data, $this->properties($ctx, $oid));
        $ctx->conn->query('SELECT cron.alter_job($1, $2, $3, $4, $5, $6)', [$oid, $job['schedule'], $job['command'], $job['database'], $job['username'], $job['active'] ? 't' : 'f']);

        return $this->node($ctx, $oid);
    }

    public function delete(NodeContext $ctx, int $oid, bool $cascade): void
    {
        $this->check($ctx->conn);
        $this->properties($ctx, $oid);
        $ctx->conn->query('SELECT cron.unschedule($1::bigint)', [$oid]);
    }

    public function sql(NodeContext $ctx, int $oid): string
    {
        $job = $this->properties($ctx, $oid);

        return sprintf("-- pg_cron job: %s\n\n-- SELECT cron.unschedule(%d);\n\n%s", $job['name'], $oid, self::schedule($job));
    }

    public function modifiedSql(NodeContext $ctx, ?int $oid, array $data): string
    {
        $this->check($ctx->conn);
        $job = self::input($ctx, $data, $oid === null ? null : $this->properties($ctx, $oid));
        if ($oid === null) {
            return self::schedule($job);
        }

        return sprintf(
            'SELECT cron.alter_job(%d, schedule => %s, command => %s, database => %s, username => %s, active => %s);',
            $oid,
            Quoting::literal($job['schedule']),
            Quoting::literal($job['command']),
            Quoting::literal($job['database']),
            Quoting::literal($job['username']),
            $job['active'] ? 'true' : 'false',
        );
    }

    /** The job's runs, newest first: pg_cron's cron.job_run_details. */
    public function statistics(NodeContext $ctx, ?int $oid): array
    {
        $this->check($ctx->conn);
        $columns = [['name' => 'runid', 'type' => 'bigint'], ['name' => 'jobid', 'type' => 'bigint'], ['name' => 'status', 'type' => 'text'], ['name' => 'start_time', 'type' => 'timestamp with time zone'], ['name' => 'end_time', 'type' => 'timestamp with time zone'], ['name' => 'database', 'type' => 'text'], ['name' => 'username', 'type' => 'text'], ['name' => 'return_message', 'type' => 'text']];
        if (!self::hasRuns($ctx->conn)) {
            return ['columns' => $columns, 'rows' => []];
        }
        $rows = $ctx->conn->rows(
            'SELECT runid, jobid, status, start_time, end_time, database, username, return_message FROM cron.job_run_details'
            . ($oid === null ? '' : ' WHERE jobid = $1') . ' ORDER BY start_time DESC NULLS LAST LIMIT ' . self::RUNS,
            $oid === null ? [] : [$oid],
        );

        return ['columns' => $columns, 'rows' => $rows];
    }

    /**
     * cron.schedule_in_database() making the job, its values as literals. A job without a name
     * (made with the two-argument cron.schedule()) is made again the same way, as
     * schedule_in_database() requires a name: cron.schedule() for the schedule and command,
     * inside the cron.alter_job() that sets its database, role and Active.
     */
    private static function schedule(array $job): string
    {
        if ((string) ($job['jobname'] ?? '') === '') {
            return sprintf(
                "SELECT cron.alter_job(\n    cron.schedule(%s, %s),\n    database => %s,\n    username => %s,\n    active => %s\n);",
                Quoting::literal((string) $job['schedule']),
                Quoting::literal((string) $job['command']),
                Quoting::literal((string) $job['database']),
                Quoting::literal((string) $job['username']),
                filter_var($job['active'], FILTER_VALIDATE_BOOL) ? 'true' : 'false',
            );
        }

        return sprintf(
            "SELECT cron.schedule_in_database(\n    job_name => %s,\n    schedule => %s,\n    command => %s,\n    database => %s,\n    username => %s,\n    active => %s\n);",
            Quoting::literal((string) $job['jobname']),
            Quoting::literal((string) $job['schedule']),
            Quoting::literal((string) $job['command']),
            Quoting::literal((string) $job['database']),
            Quoting::literal((string) $job['username']),
            filter_var($job['active'], FILTER_VALIDATE_BOOL) ? 'true' : 'false',
        );
    }

    /**
     * The job the client describes, over the stored one when there is one.
     *
     * @param array<string, mixed> $data
     * @param array<string, mixed>|null $old
     * @return array{jobname: string, schedule: string, command: string, database: string, username: string, active: bool}
     */
    private static function input(NodeContext $ctx, array $data, ?array $old): array
    {
        $text = static fn (string $key, string $default): string => trim((string) (array_key_exists($key, $data) && $data[$key] !== null ? $data[$key] : $default));
        $job = [
            'jobname' => $old === null ? $text('jobname', '') : (string) ($old['jobname'] ?? ''),
            'schedule' => $text('schedule', (string) ($old['schedule'] ?? '')),
            'command' => trim((string) ($data['command'] ?? $old['command'] ?? '')),
            // Left empty, this database and the signed-in role, as pg_cron's own defaults.
            'database' => $text('database', '') ?: (string) ($old['database'] ?? $ctx->conn->database()),
            'username' => $text('username', '') ?: (string) ($old['username'] ?? $ctx->pool->username()),
            'active' => array_key_exists('active', $data) ? filter_var($data['active'], FILTER_VALIDATE_BOOL) : filter_var($old['active'] ?? true, FILTER_VALIDATE_BOOL),
        ];
        if ($old === null && $job['jobname'] === '') {
            throw new BadRequestException('A job needs a name.');
        }
        if ($job['schedule'] === '') {
            throw new BadRequestException('A job needs a schedule: five cron fields ("0 3 * * *"), @daily and the like, or "30 seconds".');
        }
        if ($job['command'] === '') {
            throw new BadRequestException('A job needs a command.');
        }

        return $job;
    }

    private function check(Connection $conn): void
    {
        $version = $conn->scalar("SELECT extversion FROM pg_catalog.pg_extension WHERE extname = 'pg_cron'");
        if ($version === null) {
            throw new BadRequestException('The database has no pg_cron extension.');
        }
        if (version_compare((string) $version, self::MIN_VERSION, '<')) {
            throw new BadRequestException(sprintf('pg_cron %s is installed; the jobs need pg_cron %s or later (ALTER EXTENSION pg_cron UPDATE).', $version, self::MIN_VERSION));
        }
    }

    private static function hasRuns(Connection $conn): bool
    {
        return $conn->scalar("SELECT pg_catalog.to_regclass('cron.job_run_details') IS NOT NULL") === true;
    }
}
