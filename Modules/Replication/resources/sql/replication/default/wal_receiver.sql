{# What a standby receives and replays: its WAL receiver, and the recovery functions. #}
SELECT w.*,
    pg_catalog.pg_last_wal_receive_lsn()::text AS receive_lsn,
    pg_catalog.pg_last_wal_replay_lsn()::text AS replay_lsn,
    pg_catalog.pg_last_xact_replay_timestamp() AS replay_timestamp,
    pg_catalog.pg_wal_lsn_diff(pg_catalog.pg_last_wal_receive_lsn(), pg_catalog.pg_last_wal_replay_lsn())::bigint AS replay_lag_bytes,
    pg_catalog.pg_is_wal_replay_paused() AS replay_paused
FROM (SELECT 1) AS one
LEFT JOIN pg_catalog.pg_stat_wal_receiver w ON true
