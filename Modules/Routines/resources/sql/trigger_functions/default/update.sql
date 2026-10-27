{% import 'macros/functions/security.macros' as SECLABEL %}
{% import 'macros/functions/privilege.macros' as PRIVILEGE %}
{% import 'macros/functions/variable.macros' as VARIABLE %}{% if data %}
{% set name = o_data.name %}
{% set exclude_quoting = ['search_path'] %}
{% if data.name %}
{% if data.name != o_data.name %}
ALTER FUNCTION {{ conn|qtIdent(o_data.pronamespace, o_data.name) }}({{
o_data.proargtypenames }})
    RENAME TO {{ conn|qtIdent(data.name) }};
{% set name = data.name %}
{% endif %}
{% endif -%}
{% if data.change_func  %}

CREATE OR REPLACE FUNCTION {{ conn|qtIdent(o_data.pronamespace, name) }}()
    RETURNS {{ o_data.prorettypename }}
{% if data.lanname is defined %}
    LANGUAGE {{ data.lanname|qtLiteral(conn) }} {% else %}
    LANGUAGE {{ o_data.lanname|qtLiteral(conn) }}
    {% endif %}{% if data.provolatile is defined and data.provolatile %}{{ data.provolatile }}{% elseif data.provolatile is not defined and o_data.provolatile %}{{ o_data.provolatile }}{% endif %}
{% if (data.proleakproof is defined and data.proleakproof) or (data.proleakproof is not defined and o_data.proleakproof) %} LEAKPROOF{% elseif data.proleakproof is defined and not data.proleakproof %} NOT LEAKPROOF{% endif %}
{% if (data.proisstrict is defined and data.proisstrict) or (data.proisstrict is not defined and o_data.proisstrict) %} STRICT{% endif %}
{% if (data.prosecdef is defined and data.prosecdef) or (data.prosecdef is not defined and o_data.prosecdef) %} SECURITY DEFINER{% endif %}
{% if (data.proiswindow is defined and data.proiswindow) or (data.proiswindow is not defined and o_data.proiswindow) %} WINDOW{% endif %}

    {% if data.procost %}COST {{data.procost}}{% elseif o_data.procost %}COST {{o_data.procost}}{% endif %}{% if data.prorows %}

    ROWS {{data.prorows}}{% elseif data.prorows is not defined and o_data.prorows and o_data.prorows != '0' %}    ROWS {{o_data.prorows}} {%endif -%}{% if data.merged_variables %}{% for v in data.merged_variables %}

    SET {{ conn|qtIdent(v.name) }}={% if v.name in exclude_quoting %}{{ v.value }}{% else %}{{ v.value|qtLiteral(conn) }}{% endif %}{% endfor -%}
    {% endif %}

AS {% if (data.lanname == 'c' or o_data.lanname == 'c') and (data.probin is defined or data.prosrc_c is defined) %}
{% if data.probin is defined %}{{ data.probin|qtLiteral(conn) }}{% else %}{{ o_data.probin|qtLiteral(conn) }}{% endif %}, {% if data.prosrc_c is defined %}{{ data.prosrc_c|qtLiteral(conn) }}{% else %}{{ o_data.prosrc_c|qtLiteral(conn) }}{% endif %}{% elseif data.prosrc is defined %}
$BODY${{ data.prosrc }}$BODY${% elseif o_data.lanname == 'c' %}
{{ o_data.probin|qtLiteral(conn) }}, {{ o_data.prosrc_c|qtLiteral(conn) }}{% else %}
$BODY${{ o_data.prosrc }}$BODY${% endif -%};
{% endif -%}
{% if data.funcowner %}

ALTER FUNCTION {{ conn|qtIdent(o_data.pronamespace, name) }}({{o_data.proargtypenames }})
    OWNER TO {{ conn|qtIdent(data.funcowner) }};
{% endif -%}
{# The SQL generated below will change priviledges #}
{% if data.acl %}
{% if data.acl.deleted is defined %}
{% for priv in data.acl.deleted %}

{{ PRIVILEGE.UNSETALL(conn, 'FUNCTION', priv.grantee, name, o_data.pronamespace, o_data.proargtypenames) }}
{% endfor %}
{% endif -%}
{% if data.acl.changed is defined %}
{% for priv in data.acl.changed %}

{% if priv.grantee != priv.old_grantee %}
{{ PRIVILEGE.UNSETALL(conn, 'FUNCTION', priv.old_grantee, name, o_data.pronamespace, o_data.proargtypenames) }}
{% else %}
{{ PRIVILEGE.UNSETALL(conn, 'FUNCTION', priv.grantee, name, o_data.pronamespace, o_data.proargtypenames) }}
{% endif %}

{{ PRIVILEGE.SET(conn, 'FUNCTION', priv.grantee, name, priv.without_grant, priv.with_grant, o_data.pronamespace, o_data.proargtypenames) }}
{% endfor %}
{% endif -%}
{% if data.acl.added is defined %}
{% for priv in data.acl.added %}

{{ PRIVILEGE.SET(conn, 'FUNCTION', priv.grantee, name, priv.without_grant, priv.with_grant, o_data.pronamespace, o_data.proargtypenames) }}
{% endfor %}{% endif -%}
{% endif -%}
{% if data.change_func is same as(false) %}
{% if data.variables %}
{% if data.variables.deleted is defined and data.variables.deleted|length > 0 %}

{{ VARIABLE.UNSET(conn, 'FUNCTION', name, data.variables.deleted, o_data.pronamespace, o_data.proargtypenames) }}
{% endif -%}
{% if data.merged_variables is defined and data.merged_variables|length > 0 %}

{{ VARIABLE.SET(conn, 'FUNCTION', name, data.merged_variables, o_data.pronamespace, o_data.proargtypenames) }}
{% endif -%}
{% endif -%}
{% endif -%}
{% set seclabels = data.seclabels %}
{% if seclabels.deleted is defined and seclabels.deleted|length > 0 %}
{% for r in seclabels.deleted %}

{{ SECLABEL.UNSET(conn, 'FUNCTION', name, r.provider, o_data.pronamespace, o_data.proargtypenames) }}
{% endfor %}
{% endif -%}
{% if seclabels.added is defined and seclabels.added|length > 0 %}
{% for r in seclabels.added %}

{{ SECLABEL.SET(conn, 'FUNCTION', name, r.provider, r.label, o_data.pronamespace, o_data.proargtypenames) }}
{% endfor %}
{% endif -%}
{% if seclabels.changed is defined and seclabels.changed|length > 0 %}
{% for r in seclabels.changed %}

{{ SECLABEL.SET(conn, 'FUNCTION', name, r.provider, r.label, o_data.pronamespace, o_data.proargtypenames) }}
{% endfor %}
{% endif -%}
{% if data.description is defined and data.description != o_data.description%}

COMMENT ON FUNCTION {{ conn|qtIdent(o_data.pronamespace, name) }}({{o_data.proargtypenames }})
    IS {{ data.description|qtLiteral(conn) }};
{% endif -%}

{% if data.pronamespace %}

ALTER FUNCTION {{ conn|qtIdent(o_data.pronamespace, name) }}({{o_data.proargtypenames }})
    SET SCHEMA {{ conn|qtIdent(data.pronamespace) }};
{% endif -%}

{% endif %}
