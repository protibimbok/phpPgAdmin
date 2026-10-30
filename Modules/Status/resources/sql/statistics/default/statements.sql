{# pg_stat_statements: the top statements by one column, of one database or of all. #}
SELECT
    s.queryid::text AS queryid,
    d.datname,
    r.rolname,
    s.query,
    s.calls,
    s.total_exec_time,
    s.mean_exec_time,
    s.rows,
    s.shared_blks_hit,
    s.shared_blks_read
FROM
    {{ conn|qtIdent(nspname) }}.pg_stat_statements s
    LEFT JOIN pg_catalog.pg_database d ON d.oid = s.dbid
    LEFT JOIN pg_catalog.pg_roles r ON r.oid = s.userid
{% if did %}WHERE
    s.dbid = {{ did|qtLiteral(conn) }}::oid
{% endif %}ORDER BY
    s.{{ conn|qtIdent(sort) }} {% if ascending %}ASC{% else %}DESC{% endif %}, s.queryid
LIMIT {{ limit }}
