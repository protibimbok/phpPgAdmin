{# pgAdmin's replication_stats.sql, with how far each standby's replay is behind the WAL this server has. #}
SELECT r.*,
    pg_catalog.pg_wal_lsn_diff(CASE WHEN pg_catalog.pg_is_in_recovery() THEN pg_catalog.pg_last_wal_receive_lsn() ELSE pg_catalog.pg_current_wal_lsn() END, r.replay_lsn)::bigint AS replay_lag_bytes
FROM pg_catalog.pg_stat_replication r
ORDER BY r.application_name, r.pid
