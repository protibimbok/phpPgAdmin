{# The foreign keys of other tables (and of this one) that reference the table; a partition's copy of its parent's key is left out #}
SELECT con.oid, con.conname AS name, n.nspname AS schema, c.relname AS "table",
    (SELECT pg_catalog.string_agg(a.attname, ', ' ORDER BY k.n)
     FROM pg_catalog.unnest(con.conkey) WITH ORDINALITY AS k(attnum, n)
     JOIN pg_catalog.pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = k.attnum) AS columns,
    (SELECT pg_catalog.string_agg(a.attname, ', ' ORDER BY k.n)
     FROM pg_catalog.unnest(con.confkey) WITH ORDINALITY AS k(attnum, n)
     JOIN pg_catalog.pg_attribute a ON a.attrelid = con.confrelid AND a.attnum = k.attnum) AS referenced_columns,
    pg_catalog.pg_get_constraintdef(con.oid, true) AS definition
FROM pg_catalog.pg_constraint con
    JOIN pg_catalog.pg_class c ON c.oid = con.conrelid
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
WHERE con.contype = 'f' AND con.confrelid = {{ tid }}::oid AND con.conparentid = 0
ORDER BY n.nspname, c.relname, con.conname;
