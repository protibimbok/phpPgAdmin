{# CREATE FTS CONFIGURATION Statement #}
{% if data and data.schema and data.name %}
CREATE TEXT SEARCH CONFIGURATION {{ conn|qtIdent(data.schema, data.name) }} (
{% if data.copy_config is defined and data.copy_config != '' %}
    COPY={{ data.copy_config }}
{% elseif data.prsname is defined and data.prsname != '' %}
    PARSER = {{ data.prsname }}
{% endif %}
);

{% if data.owner is defined and data.owner != '' %}
ALTER TEXT SEARCH CONFIGURATION {{ conn|qtIdent(data.schema, data.name) }} OWNER TO {{ conn|qtIdent(data.owner) }};
{% endif %}

{# Description for FTS_CONFIGURATION #}
{% if data.description %}
COMMENT ON TEXT SEARCH CONFIGURATION {{ conn|qtIdent(data.schema, data.name) }}
    IS {{ data.description|qtLiteral(conn) }};
{% endif %}{% endif %}
