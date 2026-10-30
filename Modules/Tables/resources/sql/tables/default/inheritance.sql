{# The tables this one inherits from (parents) or that inherit from it (children), partitions with their bounds #}
SELECT c.oid, n.nspname AS schema, c.relname AS name, c.relkind::text AS relkind,
    c.relispartition AS is_partition,
    CASE WHEN c.relispartition THEN pg_catalog.pg_get_expr(c.relpartbound, c.oid) END AS bound
FROM pg_catalog.pg_inherits i
    JOIN pg_catalog.pg_class c ON c.oid = {% if parents %}i.inhparent{% else %}i.inhrelid{% endif %}

    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
WHERE {% if parents %}i.inhrelid{% else %}i.inhparent{% endif %} = {{ tid }}::oid
ORDER BY {% if parents %}i.inhseqno{% else %}n.nspname, c.relname{% endif %};
