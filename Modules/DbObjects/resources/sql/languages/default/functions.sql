{# The signatures CREATE LANGUAGE takes: a handler returns language_handler and takes nothing, an
   inline handler takes one internal and a validator one oid, both returning void. Built-in
   (internal) functions and operator class support functions share those signatures but cannot
   serve a procedural language, so they are left out. #}
SELECT
    CASE WHEN nspname != 'pg_catalog' THEN pg_catalog.quote_ident(nspname) || '.' || pg_catalog.quote_ident(proname)
    ELSE pg_catalog.quote_ident(proname)
    END AS label,
    CASE
    WHEN prorettype = 2280 THEN 'handler'
    WHEN proargtypes[0] = 2281 THEN 'inline'
    ELSE 'validator'
    END AS prop_type
FROM
    pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace nsp ON nsp.oid=pronamespace
WHERE
    (
        (prorettype=2280 AND pronargs=0) OR
        (prorettype=2278 AND pronargs=1 AND proargtypes[0]=26) OR
        (prorettype=2278 AND pronargs=1 AND proargtypes[0]=2281)
    )
    AND prolang != (SELECT oid FROM pg_catalog.pg_language WHERE lanname = 'internal')
    AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_amproc ap WHERE ap.amproc = p.oid)
ORDER BY label
