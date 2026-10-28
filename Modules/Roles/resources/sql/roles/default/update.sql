{% import 'macros/security.macros' as SECLABEL %}
{% import 'macros/variable.macros' as VARIABLE %}
{% if data.rolname is defined %}
{% set rolname=data.rolname %}
ALTER ROLE {{ conn|qtIdent(role) }}
	RENAME TO {{ conn|qtIdent(rolname) }};

{% else %}
{% set rolname=role %}
{% endif %}
{% if data|hasAny(alterKeys) %}
ALTER ROLE {{ conn|qtIdent(rolname) }}{% if data.rolcanlogin is defined %}

{% if data.rolcanlogin %}
	LOGIN{% else %}
	NOLOGIN{% endif %}{% endif %}{% if data.rolsuper is defined %}

{% if data.rolsuper %}
	SUPERUSER{% else %}
	NOSUPERUSER{% endif %}{% endif %}{% if data.rolcreatedb is defined %}

{% if data.rolcreatedb %}
	CREATEDB{% else %}
	NOCREATEDB{% endif %}{% endif %}{% if data.rolcreaterole is defined %}

{% if data.rolcreaterole %}
	CREATEROLE{% else %}
	NOCREATEROLE{% endif %}{% endif %}{% if data.rolinherit is defined %}

{% if data.rolinherit %}
	INHERIT{% else %}
	NOINHERIT{% endif %}{% endif %}{% if data.rolreplication is defined %}

{% if data.rolreplication %}
	REPLICATION{% else %}
	NOREPLICATION{% endif %}{% endif %}{% if data.rolbypassrls is defined %}

{% if data.rolbypassrls %}
	BYPASSRLS{% else %}
	NOBYPASSRLS{% endif %}{% endif %}{% if data.rolconnlimit is defined and data.rolconnlimit is number and data.rolconnlimit >= -1 %}

	CONNECTION LIMIT {{ data.rolconnlimit }}
{% endif %}{% if data.rolvaliduntil is defined %}

	VALID UNTIL {% if data.rolvaliduntil and data.rolvaliduntil is not null %}{{ data.rolvaliduntil|qtLiteral(conn) }}{% else %}'infinity'
{% endif %}{% endif %}{% if data.rolpassword is defined %}

	PASSWORD{% if data.rolpassword is null %} NULL{% else %}{% if dummy %} 'xxxxxx'{% else %} {{ data.rolpassword|qtLiteral(conn) }}{% endif %}{% endif %}{% endif %};{% endif %}

{% if data.rolmembership_revoked_list and data.rolmembership_revoked_list|length > 0 %}
{% for item in data.rolmembership_revoked_list %}

REVOKE {{ conn|qtIdent(item.role) }} FROM {{ conn|qtIdent(rolname) }};
{% endfor %}
{% endif %}
{% if data.rolmembership_list and data.rolmembership_list|length > 0 %}
{% for item in data.rolmembership_list %}

GRANT {{ conn|qtIdent(item.role) }} TO {{ conn|qtIdent(rolname) }}{% if item.admin is defined and item.admin %} WITH ADMIN OPTION{% endif %};
{% endfor %}
{% endif %}
{% if data.rolmembership_revoked_admins and data.rolmembership_revoked_admins|length > 0 %}
{% for item in data.rolmembership_revoked_admins %}
{% if item.admin is defined and not item.admin %}

REVOKE ADMIN OPTION FOR {{ conn|qtIdent(item.role) }} FROM {{ conn|qtIdent(rolname) }};
{% endif %}
{% endfor %}
{% endif %}
{% if data.seclabels and
	data.seclabels|length > 0
%}{% set seclabels = data.seclabels %}
{% if seclabels.deleted is defined and seclabels.deleted|length > 0 %}

{% for r in seclabels.deleted %}
{{ SECLABEL.DROP(conn, 'ROLE', rolname, r.provider) }}
{% endfor %}
{% endif %}
{% if seclabels.added is defined and seclabels.added|length > 0 %}

{% for r in seclabels.added %}
{{ SECLABEL.APPLY(conn, 'ROLE', rolname, r.provider, r.label) }}
{% endfor %}
{% endif %}
{% if seclabels.changed is defined and seclabels.changed|length > 0 %}

{% for r in seclabels.changed %}
{{ SECLABEL.APPLY(conn, 'ROLE', rolname, r.provider, r.label) }}
{% endfor %}
{% endif %}
{% endif %}
{% if data.variables is defined and data.variables|length > 0 %}
{% set variables = data.variables %}
{% if variables.deleted is defined and variables.deleted|length > 0 %}

{% for var in variables.deleted %}
{{ VARIABLE.RESET(conn, var.database, rolname, var.name) }}
{% endfor %}{% endif %}
{% if variables.added is defined and variables.added|length > 0 %}

{% for var in variables.added %}
{{ VARIABLE.APPLY(conn, var.database, rolname, var.name, var.value) }}
{% endfor %}{% endif %}
{% if variables.changed is defined and variables.changed|length > 0 %}

{% for var in variables.changed %}
{{ VARIABLE.APPLY(conn, var.database, rolname, var.name, var.value) }}
{% endfor %}
{% endif %}
{% endif %}
{% if data.description is defined %}


COMMENT ON ROLE {{ conn|qtIdent(rolname) }} IS {{ data.description|qtLiteral(conn) }};
{% endif %}
{% if data.rol_members_revoked_list and data.rol_members_revoked_list|length > 0 %}
{% for item in data.rol_members_revoked_list %}

REVOKE {{ conn|qtIdent(rolname) }} FROM {{ conn|qtIdent(item.role) }};
{% endfor %}
{% endif %}
{% if data.rol_members_list and data.rol_members_list|length > 0 %}
{% for item in data.rol_members_list %}

GRANT {{ conn|qtIdent(rolname) }} TO {{ conn|qtIdent(item.role) }}{% if item.admin is defined and item.admin %} WITH ADMIN OPTION{% endif %};
{% endfor %}
{% endif %}
{% if data.rol_members_revoked_admins and data.rol_members_revoked_admins|length > 0 %}
{% for item in data.rol_members_revoked_admins %}
{% if item.admin is defined and not item.admin %}

REVOKE ADMIN OPTION FOR {{ conn|qtIdent(rolname) }} FROM {{ conn|qtIdent(item.role) }};
{% endif %}
{% endfor %}
{% endif %}
