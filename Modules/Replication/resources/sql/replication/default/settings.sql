SELECT name, pg_catalog.current_setting(name) AS value, context, pending_restart
FROM pg_catalog.pg_settings
WHERE name = ANY ({{ names|qtLiteral(conn) }}::text[])
ORDER BY pg_catalog.array_position({{ names|qtLiteral(conn) }}::text[], name)
