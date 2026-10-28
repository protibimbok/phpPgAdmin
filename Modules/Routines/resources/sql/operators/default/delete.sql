{# DROP OPERATOR names a missing operand as NONE #}
{% if name %}
DROP OPERATOR IF EXISTS {{ conn|qtIdent(oprnamespace) }}.{{ name }} ({{ lefttype ?: 'NONE' }}, {{ righttype ?: 'NONE' }}){% if cascade %} CASCADE{% endif %};
{% endif %}
