{# A bare commutator or negator is taken from the operator's own schema, as pg_dump writes it; otherwise PostgreSQL would make a shell operator in the first schema of search_path #}
{% if data %}
CREATE OPERATOR {{ conn|qtIdent(data.schema) }}.{{data.name}} (
    FUNCTION = {{data.operproc}}{% if data.lefttype %},
    LEFTARG = {{data.lefttype}}{% endif %}{% if data.righttype %},
    RIGHTARG = {{data.righttype}}{% endif %}{% if data.commutator %},
    COMMUTATOR = {% if '(' in data.commutator or '.' in data.commutator %}{{data.commutator}}{% else %}OPERATOR({{ conn|qtIdent(data.schema) }}.{{data.commutator}}){% endif %}{% endif %}{% if data.negator %},
    NEGATOR = {% if '(' in data.negator or '.' in data.negator %}{{data.negator}}{% else %}OPERATOR({{ conn|qtIdent(data.schema) }}.{{data.negator}}){% endif %}{% endif %}{% if data.restrproc %},
    RESTRICT = {{data.restrproc}}{% endif %}{% if data.joinproc %},
    JOIN = {{data.joinproc}}{% endif %}{% if data.support_hash %},
    HASHES{% endif %}{% if data.support_merge %}, MERGES{% endif %}

);
{% endif %}
