{# The apply worker of each subscription (its table sync workers have a relid). #}
SELECT stat.subid AS oid, stat.pid, stat.received_lsn::text AS received_lsn, stat.latest_end_lsn::text AS latest_end_lsn,
    stat.last_msg_send_time, stat.last_msg_receipt_time, stat.latest_end_time,
    NULL::bigint AS apply_error_count, NULL::bigint AS sync_error_count
FROM pg_catalog.pg_stat_subscription stat
JOIN pg_catalog.pg_subscription sub ON sub.oid = stat.subid
WHERE sub.subdbid = {{ did }} AND stat.relid IS NULL
