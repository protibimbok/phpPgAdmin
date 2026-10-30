SELECT op.oid FROM pg_catalog.pg_operator op
WHERE op.oprnamespace = {{ scid }}::oid AND op.oprname = {{ name|qtLiteral(conn) }}
    AND op.oprleft = {% if lefttype %}pg_catalog.to_regtype({{ lefttype|qtLiteral(conn) }}){% else %}0{% endif %}

    AND op.oprright = {% if righttype %}pg_catalog.to_regtype({{ righttype|qtLiteral(conn) }}){% else %}0{% endif %};
