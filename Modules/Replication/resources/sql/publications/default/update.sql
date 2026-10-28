{% set events = [] %}
{% for event in ['insert', 'update', 'delete', 'truncate'] %}
{% if data['evnt_' ~ event] %}{% set events = events|merge([event]) %}{% endif %}
{% endfor %}
{###  Alter publication owner ###}
{% if data.pubowner and data.pubowner != o_data.pubowner %}
ALTER PUBLICATION {{ conn|qtIdent(o_data.name) }}
    OWNER TO {{ conn|qtIdent(data.pubowner) }};

{% endif %}
{###  Alter publication event ###}
{% if data.evnt_insert != o_data.evnt_insert or data.evnt_update != o_data.evnt_update or data.evnt_delete != o_data.evnt_delete or data.evnt_truncate != o_data.evnt_truncate %}
ALTER PUBLICATION {{ conn|qtIdent(o_data.name) }} SET
    (publish = '{{ events|join(', ') }}');

{% endif %}
{###  Alter publication partition root ###}
{% if data.publish_via_partition_root is not null and data.publish_via_partition_root != o_data.publish_via_partition_root %}
ALTER PUBLICATION {{ conn|qtIdent(o_data.name) }} SET
    (publish_via_partition_root = {{ data.publish_via_partition_root|lower }});

{% endif %}
{###  Alter drop publication table ###}
{% if drop_table_data %}
ALTER PUBLICATION {{ conn|qtIdent(o_data.name) }}
    DROP TABLE {% for pub_table in drop_table_data %}{% if not loop.first %}, {% endif %}{{ pub_table.table_name }}{% endfor %};

{% endif %}
{###  Alter drop publication schema ###}
{% if drop_schema_data %}
ALTER PUBLICATION {{ conn|qtIdent(o_data.name) }}
    DROP TABLES IN SCHEMA {{ conn|qtIdent(drop_schema_data)|join(', ') }};

{% endif %}
{###  Alter add publication table ###}
{% if add_table_data %}
ALTER PUBLICATION {{ conn|qtIdent(o_data.name) }}
    ADD {% for pub_table in add_table_data %}{% if not loop.first %}, {% endif %}TABLE {% if data.only_table %}ONLY {% endif %}{{ pub_table.table_name }}{% if pub_table.columns %} ({{ pub_table.columns|join(', ') }}){% endif %}{% if pub_table.where %} WHERE ({{ pub_table.where }}){% endif %}{% endfor %};

{% endif %}
{###  Alter add publication schema ###}
{% if add_schema_data %}
ALTER PUBLICATION {{ conn|qtIdent(o_data.name) }}
    ADD TABLES IN SCHEMA {{ conn|qtIdent(add_schema_data)|join(', ') }};

{% endif %}
{###  Comment ###}
{% if data.description is not null and data.description != (o_data.description ?? '') %}
COMMENT ON PUBLICATION {{ conn|qtIdent(o_data.name) }}
    IS {{ (data.description == '' ? null : data.description)|qtLiteral(conn) }};

{% endif %}
{###  Alter publication name ###}
{% if data.name != o_data.name %}
ALTER PUBLICATION {{ conn|qtIdent(o_data.name) }}
    RENAME TO {{ conn|qtIdent(data.name) }};
{% endif %}
