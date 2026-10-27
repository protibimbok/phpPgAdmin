{% import 'macros/functions/security.macros' as SECLABEL %}
{% import 'macros/functions/privilege.macros' as PRIVILEGE %}
{% import 'macros/functions/variable.macros' as VARIABLE %}{% if data %}
{% set name = o_data.name %}
{% set exclude_quoting = ['search_path'] %}
{% if data.name %}
{% if data.name != o_data.name %}
ALTER PROCEDURE {{ conn|qtIdent(o_data.pronamespace, o_data.name) }}{% if o_data.proargtypenames %}({{ o_data.proargtypenames }}){% endif %}

    RENAME TO {{ conn|qtIdent(data.name) }};
{% set name = data.name %}
{% endif %}

{% endif -%}
{% if data.change_func  %}
CREATE OR REPLACE PROCEDURE {{ conn|qtIdent(o_data.pronamespace, name) }}({% if data.arguments %}{% for p in data.arguments %}{% if p.argmode %}{{p.argmode}} {% endif %}{% if p.argname %}{{ conn|qtIdent(p.argname) }} {% endif %}{% if p.argtype %}{{ p.argtype }}{% endif %}{% if p.argdefval %} DEFAULT {{p.argdefval}}{% endif %}
{% if not loop.last %}, {% endif %}
{% endfor %}
{% endif %}
)
{% if data.lanname is defined %}
    LANGUAGE {{ data.lanname|qtLiteral(conn) }} {% else %}
    LANGUAGE {{ o_data.lanname|qtLiteral(conn) }}
    {% endif %}
{% if (data.prosecdef is defined and data.prosecdef) or (data.prosecdef is not defined and o_data.prosecdef) %}SECURITY DEFINER{% endif %}
{% if data.merged_variables %}{% for v in data.merged_variables %}

    SET {{ conn|qtIdent(v.name) }}={% if v.name in exclude_quoting %}{{ v.value }}{% else %}{{ v.value|qtLiteral(conn) }}{% endif %}{% endfor -%}
{% endif %}

{% if data.is_pure_sql %}{{ data.prosrc }}{% else %}
AS {% if (data.lanname == 'c' or o_data.lanname == 'c') and (data.probin is defined or data.prosrc_c is defined) %}
{% if data.probin is defined %}{{ data.probin|qtLiteral(conn) }}{% else %}{{ o_data.probin|qtLiteral(conn) }}{% endif %}, {% if data.prosrc_c is defined %}{{ data.prosrc_c|qtLiteral(conn) }}{% else %}{{ o_data.prosrc_c|qtLiteral(conn) }}{% endif %}{% elseif data.prosrc is defined %}
$BODY${{ data.prosrc }}$BODY${% elseif o_data.lanname == 'c' %}
{{ o_data.probin|qtLiteral(conn) }}, {{ o_data.prosrc_c|qtLiteral(conn) }}{% else %}
$BODY${{ o_data.prosrc }}$BODY${% endif -%};
{% endif -%}
{% endif -%}
{% if data.funcowner %}

ALTER PROCEDURE {{ conn|qtIdent(o_data.pronamespace, name) }}{% if o_data.proargtypenames %}({{ o_data.proargtypenames }}){% endif %}
    OWNER TO {{ conn|qtIdent(data.funcowner) }};
{% endif -%}
{# The SQL generated below will change priviledges #}
{% if data.acl %}
{% if data.acl.deleted is defined %}
{% for priv in data.acl.deleted %}

{{ PRIVILEGE.UNSETALL(conn, 'PROCEDURE', priv.grantee, name, o_data.pronamespace, o_data.proargtypenames) }}
{% endfor %}
{% endif -%}
{% if data.acl.changed is defined %}
{% for priv in data.acl.changed %}

{% if priv.grantee != priv.old_grantee %}
{{ PRIVILEGE.UNSETALL(conn, 'PROCEDURE', priv.old_grantee, name, o_data.pronamespace, o_data.proargtypenames) }}
{% else %}
{{ PRIVILEGE.UNSETALL(conn, 'PROCEDURE', priv.grantee, name, o_data.pronamespace, o_data.proargtypenames) }}
{% endif %}

{{ PRIVILEGE.SET(conn, 'PROCEDURE', priv.grantee, name, priv.without_grant,
 priv.with_grant, o_data.pronamespace, o_data.proargtypenames) }}
{% endfor %}
{% endif -%}
{% if data.acl.added is defined %}
{% for priv in data.acl.added %}

{{ PRIVILEGE.SET(conn, 'PROCEDURE', priv.grantee, name, priv.without_grant, priv.with_grant, o_data.pronamespace, o_data.proargtypenames) }}
{% endfor %}
{% endif %}
{% endif -%}
{% if data.change_func is same as(false) %}
{% if data.variables %}
{% if data.variables.deleted is defined and data.variables.deleted|length > 0 %}

{{ VARIABLE.UNSET(conn, 'PROCEDURE', name, data.variables.deleted, o_data.pronamespace, o_data.proargtypenames) }}
{% endif -%}
{% if data.merged_variables is defined and data.merged_variables|length > 0 %}

{{ VARIABLE.SET(conn, 'PROCEDURE', name, data.merged_variables, o_data.pronamespace, o_data.proargtypenames) }}
{% endif -%}
{% endif -%}
{% endif -%}
{% set seclabels = data.seclabels %}
{% if seclabels.deleted is defined and seclabels.deleted|length > 0 %}
{% for r in seclabels.deleted %}

{{ SECLABEL.UNSET(conn, 'PROCEDURE', name, r.provider, o_data.pronamespace, o_data.proargtypenames) }}
{% endfor %}
{% endif -%}
{% if seclabels.added is defined and seclabels.added|length > 0 %}
{% for r in seclabels.added %}

{{ SECLABEL.SET(conn, 'PROCEDURE', name, r.provider, r.label, o_data.pronamespace, o_data.proargtypenames) }}
{% endfor %}
{% endif -%}
{% if seclabels.changed is defined and seclabels.changed|length > 0 %}
{% for r in seclabels.changed %}

{{ SECLABEL.SET(conn, 'PROCEDURE', name, r.provider, r.label, o_data.pronamespace, o_data.proargtypenames) }}
{% endfor %}
{% endif -%}
{% if data.description is defined and data.description != o_data.description%}

COMMENT ON PROCEDURE {{ conn|qtIdent(o_data.pronamespace, name) }}({{o_data.proargtypenames }})
    IS {{ data.description|qtLiteral(conn) }};
{% endif -%}
{% if data.pronamespace %}

ALTER PROCEDURE {{ conn|qtIdent(o_data.pronamespace, name) }}
    SET SCHEMA {{ conn|qtIdent(data.pronamespace) }};
{% endif -%}

{% set old_exts = (o_data.dependsonextensions or []) | list %}
{% set new_exts = data.dependsonextensions is defined ? data.dependsonextensions|list : null %}

{% if new_exts is not null and old_exts != new_exts %}
{% for ext in old_exts|merge(new_exts)|unique %}

{% if ext in new_exts and ext not in old_exts %}
ALTER PROCEDURE {{ conn|qtIdent(o_data.pronamespace, name) }}({{ o_data.proargtypenames }})
    DEPENDS ON EXTENSION {{ conn|qtIdent(ext) }};
{% elseif ext in old_exts and ext not in new_exts %}
ALTER PROCEDURE {{ conn|qtIdent(o_data.pronamespace, name) }}({{ o_data.proargtypenames }})
    NO DEPENDS ON EXTENSION {{ conn|qtIdent(ext) }};
{% endif %}
{% endfor %}
{% endif %}

{% endif %}
