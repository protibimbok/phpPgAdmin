{# phpPgAdmin: the attributes of the composite types a typed table (OF type) may be made of, which become its columns #}
SELECT a.attrelid AS oid, a.attname AS name, pg_catalog.format_type(a.atttypid, a.atttypmod) AS cltype
FROM pg_catalog.pg_attribute a
JOIN pg_catalog.pg_class c ON c.oid = a.attrelid AND c.relkind = 'c'
WHERE a.attnum > 0 AND NOT a.attisdropped
ORDER BY a.attrelid, a.attnum;
