{# Below will provide oid for newly created collation #}
{% if data %}
SELECT c.oid
FROM pg_catalog.pg_collation c, pg_catalog.pg_namespace n
WHERE c.collnamespace=n.oid AND
    n.nspname = {{ data.schema|qtLiteral(conn) }} AND
    c.collname = {{ data.name|qtLiteral(conn) }}
{% elseif coid  %}
SELECT
    c.collnamespace as scid
FROM
    pg_catalog.pg_collation c
WHERE
    c.oid = {{coid}}::oid;
{% endif %}
