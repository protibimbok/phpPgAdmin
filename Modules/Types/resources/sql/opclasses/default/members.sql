{# The operators and support functions of an operator class (deptype i) or the loose ones of a family (deptype a), as pg_dump reads them #}
SELECT 'OPERATOR ' || o.amopstrategy || ' ' || o.amopopr::regoperator::text
        || CASE WHEN o.amoppurpose = 'o' THEN ' FOR ORDER BY ' || pg_catalog.quote_ident(sn.nspname) || '.' || pg_catalog.quote_ident(sf.opfname) ELSE '' END AS member,
    0 AS sort, o.amopstrategy AS number
FROM pg_catalog.pg_depend d
    JOIN pg_catalog.pg_amop o ON o.oid = d.objid
    LEFT JOIN pg_catalog.pg_opfamily sf ON sf.oid = o.amopsortfamily
    LEFT JOIN pg_catalog.pg_namespace sn ON sn.oid = sf.opfnamespace
WHERE d.classid = 'pg_catalog.pg_amop'::regclass AND d.refclassid = {{ refclass|qtLiteral(conn) }}::regclass
    AND d.refobjid = {{ oid }}::oid AND d.deptype = {{ deptype|qtLiteral(conn) }}
UNION ALL
SELECT 'FUNCTION ' || p.amprocnum || ' (' || pg_catalog.format_type(p.amproclefttype, NULL) || ', ' || pg_catalog.format_type(p.amprocrighttype, NULL) || ') ' || p.amproc::regprocedure::text,
    1, p.amprocnum
FROM pg_catalog.pg_depend d
    JOIN pg_catalog.pg_amproc p ON p.oid = d.objid
WHERE d.classid = 'pg_catalog.pg_amproc'::regclass AND d.refclassid = {{ refclass|qtLiteral(conn) }}::regclass
    AND d.refobjid = {{ oid }}::oid AND d.deptype = {{ deptype|qtLiteral(conn) }}
ORDER BY sort, number;
