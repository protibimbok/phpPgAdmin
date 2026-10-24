{% import 'macros/security.macros' as SECLABEL %}
{% import 'macros/variable.macros' as VARIABLE %}
{% import 'macros/privilege.macros' as PRIVILEGE %}
{% import 'macros/default_privilege.macros' as DEFAULT_PRIVILEGE %}
{% if data %}

{# Change the default priviledges for the functions #}
{% if data.deffuncacl %}
{% if data.deffuncacl.deleted is defined %}
{% for priv in data.deffuncacl.deleted %}
{{ DEFAULT_PRIVILEGE.RESETALL(conn, 'FUNCTIONS', priv.grantee, priv.grantor) }}
{% endfor %}
{% endif %}
{% if data.deffuncacl.changed is defined %}
{% for priv in data.deffuncacl.changed %}
{{ DEFAULT_PRIVILEGE.RESETALL(conn, 'FUNCTIONS', priv.grantee, priv.grantor) }}
{{ DEFAULT_PRIVILEGE.APPLY(conn, 'FUNCTIONS', priv.grantee, priv.without_grant, priv.with_grant, priv.grantor) }}
{% endfor %}
{% endif %}
{% if data.deffuncacl.added is defined %}
{% for priv in data.deffuncacl.added %}
{{ DEFAULT_PRIVILEGE.APPLY(conn, 'FUNCTIONS', priv.grantee, priv.without_grant, priv.with_grant, priv.grantor) }}
{% endfor %}
{% endif %}
{% endif %}

{# Change the variables/options #}
{% if data.variables and data.variables|length > 0 %}
{% set variables = data.variables %}
{% if variables.deleted is defined and variables.deleted|length > 0 %}
{% for var in variables.deleted %}
{{ VARIABLE.RESET(conn, data.name, var.role, var.name) }}
{% endfor %}
{% endif %}
{% if variables.added is defined and variables.added|length > 0 %}
{% for var in variables.added %}
{% if var.value is same as(true) %}
{{ VARIABLE.APPLY(conn, data.name, var.role, var.name, 'on') }}
{% elseif  var.value is same as(false) %}
{{ VARIABLE.APPLY(conn, data.name, var.role, var.name, 'off') }}
{% else %}
{{ VARIABLE.APPLY(conn, data.name, var.role, var.name, var.value) }}
{% endif %}
{% endfor %}
{% endif %}
{% if variables.changed is defined and variables.changed|length > 0 %}
{% for var in variables.changed %}
{% if var.value is same as(true) %}
{{ VARIABLE.APPLY(conn, data.name, var.role, var.name, 'on') }}
{% elseif  var.value is same as(false) %}
{{ VARIABLE.APPLY(conn, data.name, var.role, var.name, 'off') }}
{% else %}
{{ VARIABLE.APPLY(conn, data.name, var.role, var.name, var.value) }}
{% endif %}
{% endfor %}
{% endif %}
{% endif %}

{# Change the priviledges/ACLs #}
{% if data.datacl %}
{% if data.datacl.deleted is defined %}
{% for priv in data.datacl.deleted %}
{{ PRIVILEGE.RESETALL(conn, 'DATABASE', priv.grantee, data.name) }}
{% endfor %}
{% endif %}
{% if data.datacl.changed is defined %}
{% for priv in data.datacl.changed %}
{{ PRIVILEGE.RESETALL(conn, 'DATABASE', priv.grantee, data.name) }}
{{ PRIVILEGE.APPLY(conn, 'DATABASE', priv.grantee, data.name, priv.without_grant, priv.with_grant) }}
{% endfor %}
{% endif %}
{% if data.datacl.added is defined %}
{% for priv in data.datacl.added %}
{{ PRIVILEGE.APPLY(conn, 'DATABASE', priv.grantee, data.name, priv.without_grant, priv.with_grant) }}
{% endfor %}
{% endif %}
{% endif %}

{# Change the default priviledges for the tables #}
{% if data.deftblacl %}
{% if data.deftblacl.deleted is defined %}
{% for priv in data.deftblacl.deleted %}
{{ DEFAULT_PRIVILEGE.RESETALL(conn, 'TABLES', priv.grantee, priv.grantor) }}
{% endfor %}
{% endif %}
{% if data.deftblacl.changed is defined %}
{% for priv in data.deftblacl.changed %}
{{ DEFAULT_PRIVILEGE.RESETALL(conn, 'TABLES', priv.grantee, priv.grantor) }}
{{ DEFAULT_PRIVILEGE.APPLY(conn, 'TABLES', priv.grantee, priv.without_grant, priv.with_grant, priv.grantor) }}
{% endfor %}
{% endif %}
{% if data.deftblacl.added is defined %}
{% for priv in data.deftblacl.added %}
{{ DEFAULT_PRIVILEGE.APPLY(conn, 'TABLES', priv.grantee, priv.without_grant, priv.with_grant, priv.grantor) }}
{% endfor %}
{% endif %}
{% endif %}

{# Change the default priviledges for the sequences #}
{% if data.defseqacl %}
{% if data.defseqacl.deleted is defined %}
{% for priv in data.defseqacl.deleted %}
{{ DEFAULT_PRIVILEGE.RESETALL(conn, 'SEQUENCES', priv.grantee, priv.grantor) }}
{% endfor %}
{% endif %}
{% if data.defseqacl.changed is defined %}
{% for priv in data.defseqacl.changed %}
{{ DEFAULT_PRIVILEGE.RESETALL(conn, 'SEQUENCES', priv.grantee, priv.grantor) }}
{{ DEFAULT_PRIVILEGE.APPLY(conn, 'SEQUENCES', priv.grantee, priv.without_grant, priv.with_grant, priv.grantor) }}
{% endfor %}
{% endif %}
{% if data.defseqacl.added is defined %}
{% for priv in data.defseqacl.added %}
{{ DEFAULT_PRIVILEGE.APPLY(conn, 'SEQUENCES', priv.grantee, priv.without_grant, priv.with_grant, priv.grantor) }}
{% endfor %}
{% endif %}
{% endif %}

{# Change the default priviledges/ACLs for types #}
{% if data.deftypeacl %}
{% if data.deftypeacl.deleted is defined %}
{% for priv in data.deftypeacl.deleted %}
{{ DEFAULT_PRIVILEGE.RESETALL(conn, 'TYPES', priv.grantee, priv.grantor) }}
{% endfor %}
{% endif %}
{% if data.deftypeacl.changed is defined %}
{% for priv in data.deftypeacl.changed %}
{{ DEFAULT_PRIVILEGE.RESETALL(conn, 'TYPES', priv.grantee, priv.grantor) }}
{{ DEFAULT_PRIVILEGE.APPLY(conn, 'TYPES', priv.grantee, priv.without_grant, priv.with_grant, priv.grantor) }}
{% endfor %}
{% endif %}
{% if data.deftypeacl.added is defined %}
{% for priv in data.deftypeacl.added %}
{{ DEFAULT_PRIVILEGE.APPLY(conn, 'TYPES', priv.grantee, priv.without_grant, priv.with_grant, priv.grantor) }}
{% endfor %}
{% endif %}
{% endif %}

{# Change the security labels #}
{% if data.seclabels and data.seclabels|length > 0 %}
{% set seclabels = data.seclabels %}
{% if seclabels.deleted is defined and seclabels.deleted|length > 0 %}
{% for r in seclabels.deleted %}
{{ SECLABEL.DROP(conn, 'DATABASE', data.name, r.provider) }}
{% endfor %}
{% endif %}
{% if seclabels.added is defined and seclabels.added|length > 0 %}
{% for r in seclabels.added %}
{{ SECLABEL.APPLY(conn, 'DATABASE', data.name, r.provider, r.label) }}
{% endfor %}
{% endif %}
{% if seclabels.changed is defined and seclabels.changed|length > 0 %}
{% for r in seclabels.changed %}
{{ SECLABEL.APPLY(conn, 'DATABASE', data.name, r.provider, r.label) }}
{% endfor %}
{% endif %}
{% endif %}
{% endif %}

{# Alter database to template DB or vice versa #}
{% if data.is_template is defined %}
ALTER DATABASE {{ conn|qtIdent(data.name) }} WITH IS_TEMPLATE = {{ data.is_template }};
{% endif %}
