{# The schema's operator classes, operator families and conversions, or one of them (kind, oid) #}
SELECT * FROM (
    SELECT c.oid, c.opcname AS name, 'opclass' AS kind, n.nspname AS schema, am.amname,
        pg_catalog.format_type(c.opcintype, NULL) AS for_type, c.opcdefault AS is_default,
        CASE WHEN f.opfname = c.opcname AND f.opfnamespace = c.opcnamespace THEN NULL
            ELSE pg_catalog.quote_ident(fn.nspname) || '.' || pg_catalog.quote_ident(f.opfname) END AS family,
        CASE WHEN c.opckeytype = 0 THEN NULL ELSE pg_catalog.format_type(c.opckeytype, NULL) END AS storage,
        NULL::text AS source_encoding, NULL::text AS target_encoding, NULL::text AS function,
        pg_catalog.pg_get_userbyid(c.opcowner) AS owner, pg_catalog.obj_description(c.oid, 'pg_opclass') AS description
    FROM pg_catalog.pg_opclass c
        JOIN pg_catalog.pg_namespace n ON n.oid = c.opcnamespace
        JOIN pg_catalog.pg_am am ON am.oid = c.opcmethod
        JOIN pg_catalog.pg_opfamily f ON f.oid = c.opcfamily
        JOIN pg_catalog.pg_namespace fn ON fn.oid = f.opfnamespace
    WHERE c.opcnamespace = {{ scid }}::oid
    UNION ALL
    SELECT f.oid, f.opfname, 'opfamily', n.nspname, am.amname, NULL, NULL, NULL, NULL, NULL, NULL, NULL,
        pg_catalog.pg_get_userbyid(f.opfowner), pg_catalog.obj_description(f.oid, 'pg_opfamily')
    FROM pg_catalog.pg_opfamily f
        JOIN pg_catalog.pg_namespace n ON n.oid = f.opfnamespace
        JOIN pg_catalog.pg_am am ON am.oid = f.opfmethod
    WHERE f.opfnamespace = {{ scid }}::oid
    UNION ALL
    SELECT v.oid, v.conname, 'conversion', n.nspname, NULL, NULL, v.condefault, NULL, NULL,
        pg_catalog.pg_encoding_to_char(v.conforencoding), pg_catalog.pg_encoding_to_char(v.contoencoding), v.conproc::regproc::text,
        pg_catalog.pg_get_userbyid(v.conowner), pg_catalog.obj_description(v.oid, 'pg_conversion')
    FROM pg_catalog.pg_conversion v
        JOIN pg_catalog.pg_namespace n ON n.oid = v.connamespace
    WHERE v.connamespace = {{ scid }}::oid
) o
{% if kind %}WHERE o.kind = {{ kind|qtLiteral(conn) }} AND o.oid = {{ oid }}::oid
{% endif %}
ORDER BY o.name, o.kind;
