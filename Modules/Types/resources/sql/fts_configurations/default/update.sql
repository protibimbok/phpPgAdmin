{# UPDATE statement for FTS CONFIGURATION #}
{% if data %}
{% set name = o_data.name %}
{% set schema = o_data.schema %}
{% if data.name and data.name != o_data.name %}
{% set name = data.name %}
ALTER TEXT SEARCH CONFIGURATION {{conn|qtIdent(o_data.schema)}}.{{conn|qtIdent(o_data.name)}}
    RENAME TO {{conn|qtIdent(data.name)}};

{% endif %}
{% if data.tokens is defined %}
{% if data.tokens.changed is defined %}
{% for tok in data.tokens.changed %}
ALTER TEXT SEARCH CONFIGURATION {{conn|qtIdent(o_data.schema)}}.{{conn|qtIdent(name)}}
    ALTER MAPPING FOR {{tok.token}}
    WITH {% for dict in tok.dictname %}{{dict}}{% if not loop.last %}, {% endif %}{% endfor %};

{% endfor %}
{% endif %}
{% if data.tokens.added is defined %}
{% for tok in data.tokens.added %}
ALTER TEXT SEARCH CONFIGURATION {{conn|qtIdent(o_data.schema)}}.{{conn|qtIdent(name)}}
    ADD MAPPING FOR {{tok.token}}
    WITH {% for dict in tok.dictname %}{{dict}}{% if not loop.last %}, {% endif %}{% endfor %};

{% endfor %}
{% endif %}
{% if data.tokens.deleted is defined %}
{% for tok in data.tokens.deleted %}
ALTER TEXT SEARCH CONFIGURATION {{conn|qtIdent(o_data.schema)}}.{{conn|qtIdent(name)}}
    DROP MAPPING FOR {{tok.token}};

{% endfor %}
{% endif %}
{% endif %}
{% if data.owner is defined and data.owner != '' and data.owner != o_data.owner %}
ALTER TEXT SEARCH CONFIGURATION {{conn|qtIdent(o_data.schema)}}.{{conn|qtIdent(name)}}
    OWNER TO {{ conn|qtIdent(data.owner) }};

{% endif %}
{% if data.schema is defined and data.schema != o_data.schema %}
{% set schema = data.schema%}
ALTER TEXT SEARCH CONFIGURATION {{conn|qtIdent(o_data.schema)}}.{{conn|qtIdent(name)}}
    SET SCHEMA {{conn|qtIdent(data.schema)}};

{% endif %}
{% if data.description is defined and data.description != o_data.description %}
COMMENT ON TEXT SEARCH CONFIGURATION {{conn|qtIdent(schema)}}.{{conn|qtIdent(name)}}
    IS {{ data.description|qtLiteral(conn) }};
{% endif %}
{% endif %}
