{% import 'macros/schemas/security.macros' as SECLABEL %}
{% import 'macros/schemas/privilege.macros' as PRIVILEGE %}
{% if data %}
{% if data.name != o_data.name %}
ALTER SEQUENCE IF EXISTS {{ conn|qtIdent(o_data.schema, o_data.name) }}
    RENAME TO {{ conn|qtIdent(data.name) }};

{% endif %}
{% if data.seqowner and data.seqowner != o_data.seqowner %}
ALTER SEQUENCE IF EXISTS {{ conn|qtIdent(o_data.schema, data.name) }}
    OWNER TO {{ conn|qtIdent(data.seqowner) }};

{% endif %}
{# phpPgAdmin: OWNED BY NONE only when the client cleared an owner the sequence had (Twig reads a missing field as null) #}
{% if data.owned_table is defined and ((data.owned_table == null and data.owned_column == null) or (data.owned_table == '' and data.owned_column == '')) and (o_data.owned_table or o_data.owned_column) %}
ALTER SEQUENCE IF EXISTS {{ conn|qtIdent(o_data.schema, data.name) }}
    OWNED BY NONE;
{% elseif (data.owned_table is defined or data.owned_column is defined) and (data.owned_table != o_data.owned_table or data.owned_column != o_data.owned_column) %}
ALTER SEQUENCE IF EXISTS {{ conn|qtIdent(o_data.schema, data.name) }}
    OWNED BY {{ conn|qtIdent(o_data.schema) }}.{% if data.owned_table is defined %}{{ conn|qtIdent(data.owned_table) }}{% else %}{{ conn|qtIdent(o_data.owned_table) }}{% endif %}.{% if data.owned_column is defined %}{{ conn|qtIdent(data.owned_column) }}{% else %}{{ conn|qtIdent(o_data.owned_column) }}{% endif %};
{% endif %}
{% if data.current_value is defined %}
{% set seqname = conn|qtIdent(o_data.schema, data.name) %}
SELECT setval({{ seqname|qtLiteral(conn) }}, {{ data.current_value }}, false);

{% endif %}
{% set defquery = '' %}
{# phpPgAdmin: ALTER SEQUENCE … AS type #}
{% if data.seqtype is defined and data.seqtype %}
{% set defquery = defquery ~ '\n    AS ' ~ data.seqtype %}
{% endif %}
{% if data.increment is defined %}
{% set defquery = defquery ~ '\n    INCREMENT ' ~ data.increment|string %}
{% endif %}
{% if data.start is defined %}
{% set defquery = defquery ~ '\n    START ' ~ data.start|string %}
{% endif %}
{% if data.minimum is defined %}
{% set defquery = defquery ~ '\n    MINVALUE ' ~ data.minimum|string %}
{% endif %}
{% if data.maximum is defined %}
{% set defquery = defquery ~ '\n    MAXVALUE ' ~ data.maximum|string %}
{% endif %}
{% if data.restart is defined %}
{% set defquery = defquery ~ '\n    RESTART ' ~ data.restart|string %}
{% endif %}
{% if data.cache is defined %}
{% set defquery = defquery ~ '\n    CACHE ' ~ data.cache|string %}
{% endif %}
{% if data.cycled is same as(true) %}
{% set defquery = defquery ~ '\n    CYCLE' %}
{% elseif data.cycled is same as(false) %}
{% set defquery = defquery ~ '\n    NO CYCLE' %}
{% endif %}
{% if defquery and defquery != '' %}
ALTER SEQUENCE IF EXISTS {{ conn|qtIdent(o_data.schema, data.name) }}{{ defquery }};

{% endif %}
{% if data.schema and data.schema != o_data.schema %}
ALTER SEQUENCE IF EXISTS {{ conn|qtIdent(o_data.schema, data.name) }}
    SET SCHEMA {{ conn|qtIdent(data.schema) }};

{% set seqname = conn|qtIdent(data.schema, data.name) %}
{% set schema = data.schema %}
{% else %}
{% set seqname = conn|qtIdent(o_data.schema, data.name) %}
{% set schema = o_data.schema %}
{% endif %}
{% if data.comment is defined and data.comment != o_data.comment %}
COMMENT ON SEQUENCE {{ seqname }}
    IS {{ data.comment|qtLiteral(conn) }};

{% endif %}
{% if data.securities and data.securities|length > 0 %}

{% set seclabels = data.securities %}
{% if seclabels.deleted is defined and seclabels.deleted|length > 0 %}
{% for r in seclabels.deleted %}
{{ SECLABEL.UNSET(conn, 'SEQUENCE', data.name, r.provider, schema) }}
{% endfor %}
{% endif %}
{% if seclabels.added is defined and seclabels.added|length > 0 %}
{% for r in seclabels.added %}
{{ SECLABEL.SET(conn, 'SEQUENCE', data.name, r.provider, r.label, schema) }}
{% endfor %}
{% endif %}
{% if seclabels.changed is defined and seclabels.changed|length > 0 %}
{% for r in seclabels.changed %}
{{ SECLABEL.SET(conn, 'SEQUENCE', data.name, r.provider, r.label, schema) }}
{% endfor %}
{% endif %}
{% endif %}
{% if data.relacl %}

{% if data.relacl.deleted is defined %}
{% for priv in data.relacl.deleted %}
{{ PRIVILEGE.UNSETALL(conn, 'SEQUENCE', priv.grantee, data.name, schema) }}
{% endfor %}
{% endif %}
{% if data.relacl.changed is defined %}
{% for priv in data.relacl.changed %}
{% if priv.grantee != priv.old_grantee %}
{{ PRIVILEGE.UNSETALL(conn, 'SEQUENCE', priv.old_grantee, data.name, schema) }}
{% else %}
{{ PRIVILEGE.UNSETALL(conn, 'SEQUENCE', priv.grantee, data.name, schema) }}
{% endif %}
{{ PRIVILEGE.SET(conn, 'SEQUENCE', priv.grantee, data.name, priv.without_grant, priv.with_grant, schema) }}
{% endfor %}
{% endif %}
{% if data.relacl.added is defined %}
{% for priv in data.relacl.added %}
{{ PRIVILEGE.SET(conn, 'SEQUENCE', priv.grantee, data.name, priv.without_grant, priv.with_grant, schema) }}
{% endfor %}
{% endif %}
{% endif %}
{% endif %}
