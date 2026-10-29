{# CREATE CAST Statement #}

{% if data and data.srctyp and data.trgtyp %}
CREATE CAST ({{ data.srctyp }} AS {{ data.trgtyp }})
{% if data.proname and data.proname != 'binary compatible'%}
    WITH FUNCTION {{data.proname}}{% else %}
    WITHOUT FUNCTION{% endif %}
{% if data.castcontext == 'IMPLICIT' or data.castcontext == 'ASSIGNMENT' %}

    AS {{ data.castcontext }}{% endif %};
{# Description for CAST #}
{% if data.description %}
COMMENT ON CAST ({{ data.srctyp }} AS {{ data.trgtyp }})
    IS {{ data.description|qtLiteral(conn) }};
{% endif %}{% endif %}
