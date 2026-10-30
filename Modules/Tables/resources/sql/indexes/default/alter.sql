{### phpPgAdmin: the statistics targets of its expression columns, which CREATE INDEX cannot set ###}
{% if data.name and data.columns is defined and data.columns %}
{% for col in data.columns %}
{% if col.is_exp and col.statistics is defined and col.statistics is not null and col.statistics != '' and col.statistics != -1 %}
ALTER INDEX IF EXISTS {{conn|qtIdent(data.schema, data.name)}}
    ALTER COLUMN {{loop.index}} SET STATISTICS {{col.statistics}};

{% endif %}
{% endfor %}
{% endif %}
{## Alter index to use cluster type ##}
{% if data.indisclustered %}
ALTER TABLE IF EXISTS {{conn|qtIdent(data.schema, data.table)}}
    CLUSTER ON {{conn|qtIdent(data.name)}};
{% endif %}
{## Changes description ##}
{% if data.description is defined and data.description %}
COMMENT ON INDEX {{conn|qtIdent(data.schema, data.name)}}
    IS {{data.description|qtLiteral(conn)}};{% endif %}
