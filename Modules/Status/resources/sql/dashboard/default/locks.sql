/*pga4dash*/
SELECT
    pid,
    locktype,
    datname,
    CASE WHEN l.database IN (0, (SELECT oid FROM pg_catalog.pg_database WHERE datname = pg_catalog.current_database())) THEN relation::regclass::text ELSE relation::text END AS relation,
    page,
    tuple,
    virtualxid,
    transactionid,
    classid::regclass::text AS classid,
    objid,
    objsubid,
    virtualtransaction,
    mode,
    granted,
    fastpath
FROM
    pg_catalog.pg_locks l
    LEFT OUTER JOIN pg_catalog.pg_database d ON (l.database = d.oid)
{% if did %}WHERE
    datname = (SELECT datname FROM pg_catalog.pg_database WHERE oid = {{ did }}){% endif %}
ORDER BY
    pid, locktype
