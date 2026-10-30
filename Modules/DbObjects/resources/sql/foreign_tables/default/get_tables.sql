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
    AND n.nspname NOT LIKE 'pg\_%' AND n.nspname <> 'information_schema'
{% if foid %}
    AND c.oid <> {{foid}}::oid
{% endif %}
ORDER BY
    n.nspname, c.relname;
{% endif %}
