{% set options = [] %}
{% if data.connect is not null %}{% set options = options|merge(['connect = ' ~ data.connect|lower]) %}{% endif %}
{% set options = options|merge(['enabled = ' ~ data.enabled|lower]) %}
{% if data.copy_data is not null %}{% set options = options|merge(['copy_data = ' ~ data.copy_data|lower]) %}{% endif %}
{% if data.create_slot is not null %}{% set options = options|merge(['create_slot = ' ~ data.create_slot|lower]) %}{% endif %}
{% if data.slot_none %}{% set options = options|merge(['slot_name = NONE']) %}{% elseif data.slot_name %}{% set options = options|merge(['slot_name = ' ~ data.slot_name|qtLiteral(conn)]) %}{% endif %}
{% if data.sync %}{% set options = options|merge(['synchronous_commit = ' ~ data.sync|qtLiteral(conn)]) %}{% endif %}
{% if data.binary is not null %}{% set options = options|merge(['binary = ' ~ data.binary|lower]) %}{% endif %}
{% if data.streaming is not null %}{% set options = options|merge(['streaming = ' ~ data.streaming|qtLiteral(conn)]) %}{% endif %}
{% if data.two_phase is not null %}{% set options = options|merge(['two_phase = ' ~ data.two_phase|lower]) %}{% endif %}
{% if data.disable_on_error is not null %}{% set options = options|merge(['disable_on_error = ' ~ data.disable_on_error|lower]) %}{% endif %}
{% if data.password_required is not null %}{% set options = options|merge(['password_required = ' ~ data.password_required|lower]) %}{% endif %}
{% if data.run_as_owner is not null %}{% set options = options|merge(['run_as_owner = ' ~ data.run_as_owner|lower]) %}{% endif %}
{% if data.origin %}{% set options = options|merge(['origin = ' ~ data.origin|qtLiteral(conn)]) %}{% endif %}
{% if data.failover is not null %}{% set options = options|merge(['failover = ' ~ data.failover|lower]) %}{% endif %}
CREATE SUBSCRIPTION {{ conn|qtIdent(data.name) }}
    CONNECTION {{ conninfo|qtLiteral(conn) }}
    PUBLICATION {{ conn|qtIdent(data.pub)|join(', ') }}
    WITH ({{ options|join(', ') }});
{% if data.subowner %}

ALTER SUBSCRIPTION {{ conn|qtIdent(data.name) }}
    OWNER TO {{ conn|qtIdent(data.subowner) }};
{% endif %}
{% if data.description %}

COMMENT ON SUBSCRIPTION {{ conn|qtIdent(data.name) }}
    IS {{ data.description|qtLiteral(conn) }};
{% endif %}
