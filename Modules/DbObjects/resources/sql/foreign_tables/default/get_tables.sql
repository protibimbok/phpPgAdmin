{% if attrelid %}
SELECT
    pg_catalog.quote_ident(n.nspname) || '.' || pg_catalog.quote_ident(c.relname) AS inherits
FROM
    pg_catalog.pg_class c
    JOIN pg_catalog.pg_inherits i ON i.inhparent = c.oid
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
WHERE
    i.inhrelid = {{ attrelid }}::oid
ORDER BY
    i.inhseqno;
{% else %}
SELECT
    c.oid AS value, pg_catalog.quote_ident(n.nspname) || '.' || pg_catalog.quote_ident(c.relname) as label
FROM
    pg_catalog.pg_class c, pg_catalog.pg_namespace n
WHERE
    c.relnamespace=n.oid AND c.relkind IN ('r', 'f')
    {### phpPgAdmin: PostgreSQL refuses a partition as a parent (a partitioned table has relkind p), and a table that already inherits from this one ###}
    AND NOT c.relispartition
    AND n.nspname NOT LIKE 'pg\_%' AND n.nspname <> 'information_schema'
{% if foid %}
    AND c.oid <> {{foid}}::oid
    AND c.oid NOT IN (
        WITH RECURSIVE descendants(oid) AS (
            SELECT inhrelid FROM pg_catalog.pg_inherits WHERE inhparent = {{foid}}::oid
            UNION
            SELECT i.inhrelid FROM pg_catalog.pg_inherits i JOIN descendants d ON i.inhparent = d.oid
        )
        SELECT oid FROM descendants
    )
{% endif %}
ORDER BY
    n.nspname, c.relname;
{% endif %}
