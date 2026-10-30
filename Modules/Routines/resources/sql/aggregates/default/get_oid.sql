{# The aggregate just created: the newest of that name in the schema #}
SELECT p.oid FROM pg_catalog.pg_proc p
WHERE p.pronamespace = {{ scid }}::oid AND p.proname = {{ name|qtLiteral(conn) }} AND p.prokind = 'a'
ORDER BY p.oid DESC LIMIT 1;
