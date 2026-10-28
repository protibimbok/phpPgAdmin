{# CREATE COLLATION from a copied collation, a locale or an LC_COLLATE / LC_CTYPE pair; the options are gathered into one list #}
{% if data %}
CREATE COLLATION{% if add_not_exists_clause %} IF NOT EXISTS{% endif %} {{ conn|qtIdent(data.schema, data.name) }}
{% if data.copy_collation %}
    FROM {{ data.copy_collation }};
{% else %}
{% set options = [] %}
{% if data.locale %}
{% set options = options|merge(['LOCALE = ' ~ data.locale|qtLiteral(conn)]) %}
{% elseif data.lc_collate and data.lc_type %}
{% set options = options|merge(['LC_COLLATE = ' ~ data.lc_collate|qtLiteral(conn), 'LC_CTYPE = ' ~ data.lc_type|qtLiteral(conn)]) %}
{% endif %}
{% if data.provider %}
{% set options = options|merge(['PROVIDER = ' ~ data.provider|qtLiteral(conn)]) %}
{% endif %}
{% if data.is_deterministic is defined %}
{% set options = options|merge(['DETERMINISTIC = ' ~ data.is_deterministic|qtLiteral(conn)]) %}
{% endif %}
{% if data.rules %}
{% set options = options|merge(['RULES = ' ~ data.rules|qtLiteral(conn)]) %}
{% endif %}
{% if data.version %}
{% set options = options|merge(['VERSION = ' ~ data.version|qtLiteral(conn)]) %}
{% endif %}
    ({{ options|join(', ') }});
{% endif %}
{% if data.owner %}

ALTER COLLATION {{ conn|qtIdent(data.schema, data.name) }}
    OWNER TO {{ conn|qtIdent(data.owner) }};
{% endif %}
{% if data.description %}

COMMENT ON COLLATION {{ conn|qtIdent(data.schema, data.name) }}
    IS {{ data.description|qtLiteral(conn) }};
{% endif %}
{% endif %}
