{# The sums over pg_stat_statements, and since when it has been counting: pg_stat_statements_info (1.9, PostgreSQL 14) or the server's start. #}
SELECT
    count(*)::bigint AS statements,
    COALESCE(sum(s.calls), 0)::bigint AS calls,
    COALESCE(sum(s.total_exec_time), 0)::float8 AS total_exec_time,
    COALESCE(sum(s.rows), 0)::bigint AS rows,
{% if has_info %}
    EXTRACT(EPOCH FROM (SELECT i.stats_reset FROM {{ conn|qtIdent(nspname) }}.pg_stat_statements_info i))::float8 AS stats_reset,
{% else %}
    NULL::float8 AS stats_reset,
{% endif %}
    EXTRACT(EPOCH FROM pg_catalog.pg_postmaster_start_time())::float8 AS start_time,
    EXTRACT(EPOCH FROM now())::float8 AS now
FROM
    {{ conn|qtIdent(nspname) }}.pg_stat_statements s
{% if did %}WHERE
    s.dbid = {{ did|qtLiteral(conn) }}::oid
{% endif %}
