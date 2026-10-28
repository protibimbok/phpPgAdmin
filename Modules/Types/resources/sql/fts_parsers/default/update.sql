{# UPDATE statement for FTS PARSER #}
{% if data %}
{% if data.name and data.name != o_data.name %}
ALTER TEXT SEARCH PARSER {{conn|qtIdent(o_data.schema)}}.{{conn|qtIdent(o_data.name)}}
    RENAME TO {{conn|qtIdent(data.name)}};
{% endif %}

{#in case of rename, use new fts template name #}
{% if data.name and data.name != o_data.name %}
{% set name = data.name %}
{% else %}
{% set name = o_data.name %}
{% endif %}
{% if data.schema and data.schema != o_data.schema %}
ALTER TEXT SEARCH PARSER {{conn|qtIdent(o_data.schema)}}.{{conn|qtIdent(name)}}
    SET SCHEMA {{ conn|qtIdent(data.schema) }};
{% endif %}
{# A changed function drops and recreates the parser #}
{% if data.prsstart is defined or data.prstoken is defined or data.prsend is defined or data.prslextype is defined or data.prsheadline is defined %}
{% set headline = data.prsheadline is defined ? data.prsheadline : o_data.prsheadline %}
-- WARNING:
-- We have found the difference in either of START or GETTOKEN or END or
-- LEXTYPES or HEADLINE, so we need to drop the existing parser first
-- and re-create it.
DROP TEXT SEARCH PARSER {{conn|qtIdent(o_data.schema)}}.{{conn|qtIdent(name)}};

CREATE TEXT SEARCH PARSER {{ conn|qtIdent(o_data.schema, name) }} (
    START = {{ data.prsstart is defined ? data.prsstart : o_data.prsstart }},
    GETTOKEN = {{ data.prstoken is defined ? data.prstoken : o_data.prstoken }},
    END = {{ data.prsend is defined ? data.prsend : o_data.prsend }},
    LEXTYPES = {{ data.prslextype is defined ? data.prslextype : o_data.prslextype }}{% if headline and headline != '-' %},
    HEADLINE = {{ headline }}{% endif %}

);
{% endif %}
{% if data.description is defined and data.description != o_data.description %}
COMMENT ON TEXT SEARCH PARSER {{conn|qtIdent(o_data.schema)}}.{{conn|qtIdent(name)}}
    IS {{ data.description|qtLiteral(conn) }};
{% endif %}
{% endif %}
