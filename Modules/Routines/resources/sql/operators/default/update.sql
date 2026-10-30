{# ALTER OPERATOR for new estimators, owner, comment and schema; data holds only what changes, o_data names the operator #}
{% set operator = (conn|qtIdent(o_data.schema)) ~ '.' ~ o_data.name ~ ' (' ~ (o_data.lefttype ?: 'NONE') ~ ', ' ~ (o_data.righttype ?: 'NONE') ~ ')' %}
{% if data.restrproc is not null or data.joinproc is not null %}
ALTER OPERATOR {{ operator }}
    SET ({% if data.restrproc is not null %}RESTRICT = {{ data.restrproc ?: 'NONE' }}{% endif %}{% if data.restrproc is not null and data.joinproc is not null %}, {% endif %}{% if data.joinproc is not null %}JOIN = {{ data.joinproc ?: 'NONE' }}{% endif %});

{% endif %}
{% if data.owner %}
ALTER OPERATOR {{ operator }}
    OWNER TO {{ conn|qtIdent(data.owner) }};

{% endif %}
{% if data.description is not null %}
COMMENT ON OPERATOR {{ operator }}
    IS {{ data.description|qtLiteral(conn) }};

{% endif %}
{% if data.schema %}
ALTER OPERATOR {{ operator }}
    SET SCHEMA {{ conn|qtIdent(data.schema) }};
{% endif %}
