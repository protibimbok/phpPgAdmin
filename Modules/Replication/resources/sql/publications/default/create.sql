{% set events = [] %}
{% for event in ['insert', 'update', 'delete', 'truncate'] %}
{% if data['evnt_' ~ event] %}{% set events = events|merge([event]) %}{% endif %}
{% endfor %}
{% set objects = [] %}
{% for pub_table in data.pubtable|default([]) %}
{% set objects = objects|merge(['TABLE ' ~ (data.only_table ? 'ONLY ' : '') ~ pub_table.table_name ~ (pub_table.columns ? ' (' ~ pub_table.columns|join(', ') ~ ')' : '') ~ (pub_table.where ? ' WHERE (' ~ pub_table.where ~ ')' : '')]) %}
{% endfor %}
{% if data.pubschema %}
{% set objects = objects|merge(['TABLES IN SCHEMA ' ~ conn|qtIdent(data.pubschema)|join(', ')]) %}
{% endif %}
{###  Create PUBLICATION ###}
CREATE PUBLICATION {{ conn|qtIdent(data.name) }}
{% if data.all_table %}
    FOR ALL TABLES
{% elseif objects %}
    FOR {{ objects|join(', ') }}
{% endif %}
    WITH (publish = '{{ events|join(', ') }}', publish_via_partition_root = {{ data.publish_via_partition_root|lower }});
{% if data.pubowner %}

ALTER PUBLICATION {{ conn|qtIdent(data.name) }}
    OWNER TO {{ conn|qtIdent(data.pubowner) }};
{% endif %}
{% if data.description %}

COMMENT ON PUBLICATION {{ conn|qtIdent(data.name) }}
    IS {{ data.description|qtLiteral(conn) }};
{% endif %}
