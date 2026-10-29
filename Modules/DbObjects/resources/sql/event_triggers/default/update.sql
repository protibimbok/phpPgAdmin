{% import 'macros/security.macros' as SECLABEL %}
{% if data %}
{% if (data.eventfunname and (data.eventfunname ~ '') is not same as(o_data.eventfunname ~ '')) or
  (data.eventname and (data.eventname ~ '') is not same as(o_data.eventname ~ '')) or
  (data.when and (data.when ~ '') is not same as(o_data.when ~ '')) %}
-- WARNING:
-- We have found the difference in either of Trigger Function, Event or WHEN
-- so we need to drop the existing event trigger first and re-create it.
DROP EVENT TRIGGER IF EXISTS {{ conn|qtIdent(o_data.name) }};

CREATE EVENT TRIGGER {{ data.name ? conn|qtIdent(data.name) : conn|qtIdent(o_data.name) }} ON {{ (data.eventname ? data.eventname : o_data.eventname) }}
{% if data.when or o_data.when %}
    WHEN TAG IN ({{ (data.when ? data.when : o_data.when) }})
{% endif %}
    EXECUTE FUNCTION {{ (data.eventfunname ? data.eventfunname : o_data.eventfunname) }}();

ALTER EVENT TRIGGER {{ data.name ? conn|qtIdent(data.name) : conn|qtIdent(o_data.name) }}
    OWNER TO {{ conn|qtIdent(o_data.eventowner) }};
{# The new trigger is enabled and has no comment: re-apply the old state and comment. #}
{% if data.enabled is not defined and o_data.enabled != "O" %}

ALTER EVENT TRIGGER {{ data.name ? conn|qtIdent(data.name) : conn|qtIdent(o_data.name) }}
{% if o_data.enabled == "D" %}
    DISABLE;
{% elseif o_data.enabled == "R" %}
    ENABLE REPLICA;
{% elseif o_data.enabled == "A" %}
    ENABLE ALWAYS;
{% endif %}
{% endif %}
{% if data.comment is not defined and o_data.comment %}

COMMENT ON EVENT TRIGGER {{ data.name ? conn|qtIdent(data.name) : conn|qtIdent(o_data.name) }}
    IS {{ o_data.comment|qtLiteral(conn) }};
{% endif %}
{% else %}

{% if data.name and (data.name ~ '') is not same as(o_data.name ~ '') %}
ALTER EVENT TRIGGER {{ conn|qtIdent(o_data.name) }}
    RENAME TO {{ conn|qtIdent(data.name) }};
{% endif %}
{% endif %}

{% if data.comment is defined and (data.comment ~ '') is not same as(o_data.comment ~ '') %}
COMMENT ON EVENT TRIGGER {{ conn|qtIdent(data.name) }}
    IS {{ data.comment|qtLiteral(conn) }};
{% endif %}

{% if data.enabled and data.enabled != o_data.enabled %}
ALTER EVENT TRIGGER {{ conn|qtIdent(data.name) }}
{% if data.enabled == "O" %}
    ENABLE;
{% elseif data.enabled == "D" %}
   DISABLE;
{% elseif data.enabled == "R" %}
    ENABLE REPLICA;
{% elseif data.enabled == "A" %}
    ENABLE ALWAYS;
{% endif %}
{% endif %}
{% endif %}

{% if data.seclabels and
	data.seclabels|length > 0
%}{% set seclabels = data.seclabels %}
{% if seclabels.deleted is defined and seclabels.deleted|length > 0 %}

{% for r in seclabels.deleted %}
{{ SECLABEL.DROP(conn, 'EVENT TRIGGER', data.name, r.provider) }}
{% endfor %}
{% endif %}
{% if seclabels.added is defined and seclabels.added|length > 0 %}

{% for r in seclabels.added %}
{{ SECLABEL.APPLY(conn, 'EVENT TRIGGER', data.name, r.provider, r.label) }}
{% endfor %}
{% endif %}
{% if seclabels.changed is defined and seclabels.changed|length > 0 %}

{% for r in seclabels.changed %}
{{ SECLABEL.APPLY(conn, 'EVENT TRIGGER', data.name, r.provider, r.label) }}
{% endfor %}
{% endif %}
{% endif %}

{% if data.eventowner and (data.eventowner ~ '') is not same as(o_data.eventowner ~ '') %}
ALTER EVENT TRIGGER {{ conn|qtIdent(data.name) }}
    OWNER TO {{ conn|qtIdent(data.eventowner) }};
{% endif %}
