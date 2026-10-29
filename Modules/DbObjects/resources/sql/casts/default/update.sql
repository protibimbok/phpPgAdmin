{# UPDATE Description for CAST #}

{%  if data and data.description is defined and (data.description ~ '') is not same as(o_data.description ~ '') %}
COMMENT ON CAST ({{ o_data.srctyp }} AS {{ o_data.trgtyp }})
    IS {{ data.description|qtLiteral(conn) }};
{% endif %}
