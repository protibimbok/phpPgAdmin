{% set add_semicolon_after = 'to' %}
{% if data.withcheck is defined and data.withcheck != null and data.withcheck != '' %}
{% set add_semicolon_after = 'with_check' %}
{% elseif data.using is defined and data.using != null and data.using != '' %}
{% set add_semicolon_after = 'using' %}
{% endif %}
CREATE POLICY {{ conn|qtIdent(data.name) }}
    ON {{conn|qtIdent(data.schema, data.table)}}
{%if data.type %}
    AS {{ data.type|upper }}
{% endif %}
{% if data.event %}
    FOR {{ data.event|upper }}
{% endif %}
{% if data.policyowner %}
    TO {{ conn|qtIdent(data.policyowner)|join(', ') }}{% if add_semicolon_after == 'to' %};{% endif %}
{% else %}
    TO public{% if add_semicolon_after == 'to' %};{% endif %}
{% endif %}
{% if data.using %}

    USING ({{ data.using }}){% if add_semicolon_after == 'using' %};{% endif %}
{% endif %}
{% if data.withcheck %}

    WITH CHECK ({{ data.withcheck }});
{% endif %}

{% if data.description %}

COMMENT ON POLICY {{ conn|qtIdent(data.name) }}
    ON {{ conn|qtIdent(data.schema, data.table) }}
    IS {{ data.description|qtLiteral(conn) }};
{% endif %}
