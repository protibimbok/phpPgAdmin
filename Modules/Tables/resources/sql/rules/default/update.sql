{# ===== Update Rule ===== #}
{% if data.name is defined %}
{% set rule_name = data.name %}
{% else %}
{% set rule_name = o_data.name %}
{% endif %}
{% if data.name and data.name != o_data.name %}
ALTER RULE {{ conn|qtIdent(o_data.name) }} ON {{ conn|qtIdent(o_data.schema, o_data.view) }} RENAME TO {{ conn|qtIdent(data.name) }};

{% endif %}
{% if data.event is defined or data.do_instead is defined or data.condition is defined or data.statements is defined %}
CREATE OR REPLACE RULE {{ conn|qtIdent(rule_name) }} AS
    ON {% if data.event and data.event != o_data.event %}{{ data.event|upper }}{% else %}{{ o_data.event|upper }}{% endif %}
 TO {{ conn|qtIdent(o_data.schema, o_data.view) }}
{% if data.condition and o_data.condition != data.condition %}
    WHERE ({{ data.condition }})
{% elseif data.condition is not defined and o_data.condition %}
    WHERE ({{ o_data.condition }})
{% endif %}
    DO{% if ((data.do_instead is not defined and o_data.do_instead in ['true', true]) or (data.do_instead in ['true', true])) %}{{ ' INSTEAD' }}{% endif %}
{% if data.statements is defined %}
{% if data.statements|trim in ['', 'NOTHING'] %}
 NOTHING;
{% else %}

({{ data.statements|trim(';', 'right') }});
{% endif %}
{% elseif o_data.statements|trim in ['', 'NOTHING'] %}
 NOTHING;
{% else %}
({{ o_data.statements|trim(';', 'right') }});
{% endif %}

{% endif %}
{% set old_comment = o_data.comment|default('') %}
{% if (data.comment is defined and (data.comment != old_comment)) %}
COMMENT ON RULE {{ conn|qtIdent(rule_name) }} ON {{ conn|qtIdent(o_data.schema, o_data.view) }} IS {{ data.comment|qtLiteral(conn) }};{% endif %}

{% if data.enabled is defined and o_data.enabled != data.enabled %}
ALTER TABLE {{ conn|qtIdent(o_data.schema, o_data.view) }} {% if (data.enabled in  ['false', false]) %}DISABLE{% endif %}{% if (data.enabled in ['true', true]) %}ENABLE{% endif %} RULE {{ conn|qtIdent(o_data.name) }};
{% endif %}

{% if data.is_enable_rule is defined  and o_data.is_enable_rule != data.is_enable_rule %}
{% set enable_map = {'R':'ENABLE REPLICA', 'A':'ENABLE ALWAYS', 'O':'ENABLE', 'D':'DISABLE'} %}
ALTER TABLE {{ conn|qtIdent(o_data.schema, o_data.view) }}
    {{ enable_map[data.is_enable_rule] }} RULE {{ conn|qtIdent(o_data.name) }};
{% endif %}
