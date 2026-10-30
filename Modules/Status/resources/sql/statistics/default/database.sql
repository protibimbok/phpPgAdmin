{# pg_stat_database: one database's counters, or every database's summed. #}
SELECT
    sum(numbackends)::bigint AS numbackends,
    sum(xact_commit)::bigint AS xact_commit,
    sum(xact_rollback)::bigint AS xact_rollback,
    sum(blks_read)::bigint AS blks_read,
    sum(blks_hit)::bigint AS blks_hit,
    sum(tup_returned)::bigint AS tup_returned,
    sum(tup_fetched)::bigint AS tup_fetched,
    sum(tup_inserted)::bigint AS tup_inserted,
    sum(tup_updated)::bigint AS tup_updated,
    sum(tup_deleted)::bigint AS tup_deleted,
    sum(conflicts)::bigint AS conflicts,
    sum(temp_files)::bigint AS temp_files,
    sum(temp_bytes)::bigint AS temp_bytes,
    sum(deadlocks)::bigint AS deadlocks,
    COALESCE(sum(checksum_failures), 0)::bigint AS checksum_failures,
    max(checksum_last_failure)::text AS checksum_last_failure,
    sum(blk_read_time)::float8 AS blk_read_time,
    sum(blk_write_time)::float8 AS blk_write_time,
    min(stats_reset)::text AS stats_reset
FROM
    pg_catalog.pg_stat_database
{% if name %}WHERE
    datname = {{ name|qtLiteral(conn) }}
{% endif %}
