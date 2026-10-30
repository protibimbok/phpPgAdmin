{# ALTER AGGREGATE for a new owner, comment, name or schema; data holds only what changes #}
{% if data %}
{% if data.owner %}
ALTER AGGREGATE {{ conn|qtIdent(o_data.schema, o_data.name) }}({% if o_data.input_types %}{{ o_data.input_types }}{% else %}*{% endif %})
    OWNER TO {{ conn|qtIdent(data.owner) }};

{% endif %}
{% if data.description is not null %}
COMMENT ON AGGREGATE {{ conn|qtIdent(o_data.schema, o_data.name) }}({% if o_data.input_types %}{{ o_data.input_types }}{% else %}*{% endif %})
    IS {{ data.description|qtLiteral(conn) }};

{% endif %}
{% if data.name %}
ALTER AGGREGATE {{ conn|qtIdent(o_data.schema, o_data.name) }}({% if o_data.input_types %}{{ o_data.input_types }}{% else %}*{% endif %})
    RENAME TO {{ conn|qtIdent(data.name) }};

{% endif %}
{% if data.schema %}
ALTER AGGREGATE {{ conn|qtIdent(o_data.schema, data.name ?: o_data.name) }}({% if o_data.input_types %}{{ o_data.input_types }}{% else %}*{% endif %})
    SET SCHEMA {{ conn|qtIdent(data.schema) }};
{% endif %}
{% endif %}
