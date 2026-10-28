{# The apply worker of each subscription (its table sync workers have a relid), and the error counts. #}
SELECT sub.oid, stat.pid, stat.received_lsn::text AS received_lsn, stat.latest_end_lsn::text AS latest_end_lsn,
    stat.last_msg_send_time, stat.last_msg_receipt_time, stat.latest_end_time,
    err.apply_error_count, err.sync_error_count
FROM pg_catalog.pg_subscription sub
LEFT JOIN pg_catalog.pg_stat_subscription stat ON stat.subid = sub.oid AND stat.relid IS NULL
LEFT JOIN pg_catalog.pg_stat_subscription_stats err ON err.subid = sub.oid
WHERE sub.subdbid = {{ did }}
