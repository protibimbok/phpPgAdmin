{# pgAdmin's replication_slots.sql, with the WAL each slot holds back. #}
SELECT s.*,
    pg_catalog.pg_wal_lsn_diff(CASE WHEN pg_catalog.pg_is_in_recovery() THEN pg_catalog.pg_last_wal_receive_lsn() ELSE pg_catalog.pg_current_wal_lsn() END, s.restart_lsn)::bigint AS retained_bytes
FROM pg_catalog.pg_replication_slots s
{% if slot_name %}
WHERE s.slot_name = {{ slot_name|qtLiteral(conn) }}
{% endif %}
ORDER BY s.slot_name
