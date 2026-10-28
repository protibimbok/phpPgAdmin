<?php

declare(strict_types=1);

namespace PhpPgAdmin\Modules\Replication\Http\Controllers;

use League\Route\Http\Exception\BadRequestException;
use League\Route\Http\Exception\NotFoundException;
use PhpPgAdmin\Core\Database\Connection;
use PhpPgAdmin\Core\Database\ConnectionPool;
use PhpPgAdmin\Core\Facades\Sql;
use Psr\Http\Message\ServerRequestInterface;

/**
 * Streaming replication as pgAdmin's dashboard shows it, on phpMyAdmin's Replication page:
 * whether the server is a primary (the standbys in pg_stat_replication) or a standby (its WAL
 * receiver and replay), the replication slots, and the settings each side runs on. A slot can
 * be created and dropped, and a standby's WAL replay paused and resumed (pgAdmin's
 * wal_replay). Everything goes through the maintenance connection, as the views are
 * server-wide, except a logical slot, which is created and dropped in its own database.
 */
final class ReplicationController
{
    /** phpMyAdmin's "Primary status" table: what the server sends WAL to standbys with. */
    private const array PRIMARY_SETTINGS = ['wal_level', 'max_wal_senders', 'max_replication_slots', 'wal_keep_size', 'max_slot_wal_keep_size', 'wal_sender_timeout', 'synchronous_standby_names', 'synchronous_commit', 'archive_mode'];

    /** Its "Replica status" table: what a standby receives and replays WAL with. */
    private const array STANDBY_SETTINGS = ['primary_slot_name', 'hot_standby', 'hot_standby_feedback', 'recovery_min_apply_delay', 'max_standby_streaming_delay', 'max_standby_archive_delay', 'wal_receiver_status_interval', 'wal_receiver_timeout', 'recovery_target_timeline'];

    private const string SERVER = <<<'SQL'
        SELECT pg_catalog.pg_is_in_recovery() AS in_recovery,
               pg_catalog.current_setting('wal_level') AS wal_level,
               pg_catalog.current_setting('max_wal_senders')::int AS max_wal_senders,
               CASE WHEN pg_catalog.pg_is_in_recovery() THEN NULL ELSE pg_catalog.pg_current_wal_lsn()::text END AS current_lsn,
               CASE WHEN pg_catalog.pg_is_in_recovery() THEN NULL ELSE pg_catalog.pg_walfile_name(pg_catalog.pg_current_wal_lsn()) END AS current_walfile,
               r.rolsuper AS superuser,
               r.rolsuper OR r.rolreplication AS replication,
               r.rolsuper OR pg_catalog.pg_has_role(r.oid, 'pg_read_all_stats', 'USAGE') AS monitor,
               pg_catalog.has_function_privilege('pg_catalog.pg_wal_replay_pause()', 'EXECUTE') AS replay_control
        FROM pg_catalog.pg_roles r
        WHERE r.rolname = current_user
        SQL;

    /**
     * The page: the server's role and privileges, the primary's settings and current WAL
     * position, the standbys streaming from it, the slots, and on a standby its WAL receiver.
     *
     * @return array<string, mixed>
     */
    public function index(ServerRequestInterface $request): array
    {
        $conn = ConnectionPool::from($request)->maintenance();
        $server = $conn->row(self::SERVER) ?? [];
        $inRecovery = (bool) $server['in_recovery'];

        return [
            'server' => $server,
            'primary_settings' => $this->settings($conn, self::PRIMARY_SETTINGS),
            'standby_settings' => $inRecovery ? $this->settings($conn, self::STANDBY_SETTINGS) : [],
            'replicas' => $conn->rows($this->render($conn, 'replication_stats.sql')),
            'slots' => $conn->rows($this->render($conn, 'replication_slots.sql')),
            'receiver' => $inRecovery ? $conn->row($this->render($conn, 'wal_receiver.sql')) : null,
        ];
    }

    /**
     * pg_create_physical_replication_slot(name, immediately_reserve) or
     * pg_create_logical_replication_slot(name, plugin, false, two_phase) in the database given.
     *
     * @return array{sql: string, slot: array<string, mixed>|null}
     */
    public function createSlot(ServerRequestInterface $request): array
    {
        $body = (array) $request->getParsedBody();
        $pool = ConnectionPool::from($request);
        $name = trim((string) ($body['name'] ?? ''));
        if (preg_match('/^[a-z0-9_]{1,63}$/', $name) !== 1) {
            throw new BadRequestException('A slot name has up to 63 lower-case letters, digits and underscores.');
        }

        if (($body['type'] ?? 'physical') === 'logical') {
            $database = trim((string) ($body['database'] ?? ''));
            $plugin = trim((string) ($body['plugin'] ?? '')) ?: 'pgoutput';
            if ($database === '') {
                throw new BadRequestException('A logical slot belongs to a database; choose one.');
            }
            $conn = $pool->for($database);
            $twoPhase = ($body['two_phase'] ?? false) === true && $conn->version() >= 140000;
            $sql = sprintf(
                'SELECT pg_catalog.pg_create_logical_replication_slot(%s, %s, false%s);',
                $conn->escapeLiteral($name),
                $conn->escapeLiteral($plugin),
                $twoPhase ? ', true' : '',
            );
        } else {
            $conn = $pool->maintenance();
            $sql = sprintf(
                'SELECT pg_catalog.pg_create_physical_replication_slot(%s%s);',
                $conn->escapeLiteral($name),
                ($body['reserve'] ?? false) === true ? ', true' : '',
            );
        }
        $conn->exec($sql);

        return ['sql' => $sql, 'slot' => $conn->row($this->render($conn, 'replication_slots.sql', ['slot_name' => $name]))];
    }

    /**
     * pg_drop_replication_slot; a logical slot is dropped from its own database, as PostgreSQL
     * requires.
     *
     * @param array{name: string} $args
     * @return array{sql: string}
     */
    public function dropSlot(ServerRequestInterface $request, array $args): array
    {
        $pool = ConnectionPool::from($request);
        $name = rawurldecode($args['name']);
        $slot = $pool->maintenance()->row($this->render($pool->maintenance(), 'replication_slots.sql', ['slot_name' => $name]))
            ?? throw new NotFoundException(sprintf('There is no replication slot "%s".', $name));
        $conn = $slot['slot_type'] === 'logical' && $slot['database'] !== null ? $pool->for((string) $slot['database']) : $pool->maintenance();
        $sql = sprintf('SELECT pg_catalog.pg_drop_replication_slot(%s);', $conn->escapeLiteral($name));
        $conn->exec($sql);

        return ['sql' => $sql];
    }

    /** pgAdmin's pause_wal_replay. */
    public function pauseReplay(ServerRequestInterface $request): array
    {
        return $this->replay($request, 'pg_wal_replay_pause');
    }

    /** pgAdmin's resume_wal_replay. */
    public function resumeReplay(ServerRequestInterface $request): array
    {
        return $this->replay($request, 'pg_wal_replay_resume');
    }

    /** @return array{sql: string, replay_paused: bool} */
    private function replay(ServerRequestInterface $request, string $function): array
    {
        $conn = ConnectionPool::from($request)->maintenance();
        if (!$conn->scalar('SELECT pg_catalog.pg_is_in_recovery()')) {
            throw new BadRequestException('WAL replay can only be paused and resumed on a standby.');
        }
        $sql = sprintf('SELECT pg_catalog.%s();', $function);
        $conn->exec($sql);

        return ['sql' => $sql, 'replay_paused' => (bool) $conn->scalar('SELECT pg_catalog.pg_is_wal_replay_paused()')];
    }

    /**
     * @param list<string> $names
     * @return list<array<string, mixed>>
     */
    private function settings(Connection $conn, array $names): array
    {
        return $conn->rows($this->render($conn, 'settings.sql', ['names' => $names]));
    }

    /** @param array<string, mixed> $vars */
    private function render(Connection $conn, string $file, array $vars = []): string
    {
        return Sql::render('replication', $file, ['conn' => $conn, ...$vars], $conn->version());
    }
}
