{% set options = [] %}
{% if data.slot_none is not null and (data.slot_none ? (o_data.slot_name is not null) : (data.slot_name != o_data.slot_name)) %}{% set options = options|merge(['slot_name = ' ~ (data.slot_none ? 'NONE' : data.slot_name|qtLiteral(conn))]) %}{% endif %}
{% for option in ['binary', 'two_phase', 'disable_on_error', 'password_required', 'run_as_owner', 'failover'] %}
{% if data[option] is not null and data[option] != o_data[option] %}{% set options = options|merge([option ~ ' = ' ~ data[option]|lower]) %}{% endif %}
{% endfor %}
{% if data.sync is not null and data.sync != o_data.sync %}{% set options = options|merge(['synchronous_commit = ' ~ data.sync|qtLiteral(conn)]) %}{% endif %}
{% if data.streaming is not null and data.streaming != o_data.streaming %}{% set options = options|merge(['streaming = ' ~ data.streaming|qtLiteral(conn)]) %}{% endif %}
{% if data.origin is not null and data.origin != o_data.origin %}{% set options = options|merge(['origin = ' ~ data.origin|qtLiteral(conn)]) %}{% endif %}
{#####################################################}
{## Change owner of subscription ##}
{#####################################################}
{% if data.subowner and data.subowner != o_data.subowner %}
ALTER SUBSCRIPTION {{ conn|qtIdent(o_data.name) }}
    OWNER TO {{ conn|qtIdent(data.subowner) }};

{% endif %}
{###  Disable subscription ###}
{% if data.enabled is same as(false) and o_data.enabled %}
ALTER SUBSCRIPTION {{ conn|qtIdent(o_data.name) }} DISABLE;

{% endif %}
{###  Alter parameters of subscription ###}
{% if options %}
ALTER SUBSCRIPTION {{ conn|qtIdent(o_data.name) }}
    SET ({{ options|join(', ') }});

{% endif %}
{###  Alter subscription connection info ###}
{% if conninfo is not null %}
ALTER SUBSCRIPTION {{ conn|qtIdent(o_data.name) }}
    CONNECTION {{ conninfo|qtLiteral(conn) }};

{% endif %}
{###  Enable subscription ###}
{% if data.enabled is same as(true) and not o_data.enabled %}
ALTER SUBSCRIPTION {{ conn|qtIdent(o_data.name) }} ENABLE;

{% endif %}
{###  Alter publication of subscription ###}
{% if data.pub %}
ALTER SUBSCRIPTION {{ conn|qtIdent(o_data.name) }}
    SET PUBLICATION {{ conn|qtIdent(data.pub)|join(', ') }} WITH ({% if data.refresh_pub %}refresh = true, copy_data = {{ data.copy_data_after_refresh|lower }}{% else %}refresh = false{% endif %});

{% elseif data.refresh_pub %}
{###  Refresh publication ###}
ALTER SUBSCRIPTION {{ conn|qtIdent(o_data.name) }}
    REFRESH PUBLICATION WITH (copy_data = {{ data.copy_data_after_refresh|lower }});

{% endif %}
{###  Comment ###}
{% if data.description is not null and data.description != (o_data.description ?? '') %}
COMMENT ON SUBSCRIPTION {{ conn|qtIdent(o_data.name) }}
    IS {{ (data.description == '' ? null : data.description)|qtLiteral(conn) }};

{% endif %}
{###  Alter subscription name ###}
{% if data.name and data.name != o_data.name %}
ALTER SUBSCRIPTION {{ conn|qtIdent(o_data.name) }}
    RENAME TO {{ conn|qtIdent(data.name) }};
{% endif %}
