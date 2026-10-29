{### SQL to fetch tablespace object stats ###}
{### The size is NULL where pg_tablespace_size() would raise permission denied ###}
{% set size %}CASE WHEN pg_catalog.has_tablespace_privilege(ts.oid, 'CREATE') OR pg_catalog.pg_has_role('pg_read_all_stats', 'USAGE') OR ts.oid = (SELECT dattablespace FROM pg_catalog.pg_database WHERE datname = pg_catalog.current_database()) THEN pg_catalog.pg_tablespace_size(ts.oid) END{% endset %}
{% if tsid %}
SELECT {{ size }} AS {{ conn|qtIdent(_('Size')) }}
FROM
    pg_catalog.pg_tablespace ts
WHERE ts.oid = {{ tsid|qtLiteral(conn) }}::OID
{% else %}
SELECT ts.spcname AS {{ conn|qtIdent(_('Name')) }},
    {{ size }} AS {{ conn|qtIdent(_('Size')) }}
FROM
    pg_catalog.pg_tablespace ts;
{% endif %}
