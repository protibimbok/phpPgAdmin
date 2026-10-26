{### phpPgAdmin: the operators declared on the polymorphic pseudo-type a column of the type fits
     (anyrange for a range, anymultirange for a multirange, anyarray for an array, anyelement and
     anynonarray otherwise), which get_operator.sql misses: && on tstzrange is anyrange's. ###}
SELECT DISTINCT op.oprname
FROM pg_catalog.pg_operator op
JOIN pg_catalog.pg_type pt ON pt.oid IN (op.oprleft, op.oprright)
WHERE op.oprcom > 0
  AND pt.typname IN (
    SELECT CASE
        WHEN t.typtype = 'r' THEN 'anyrange'
        WHEN t.typtype = 'm' THEN 'anymultirange'
        WHEN t.typelem <> 0 AND t.typlen = -1 THEN 'anyarray'
        ELSE 'anyelement' END
    FROM pg_catalog.pg_type t
    WHERE pg_catalog.format_type(t.oid, NULL) = {{type|qtLiteral(conn)}}
    UNION SELECT 'anynonarray'
    FROM pg_catalog.pg_type t
    WHERE pg_catalog.format_type(t.oid, NULL) = {{type|qtLiteral(conn)}}
      AND t.typtype NOT IN ('r', 'm') AND NOT (t.typelem <> 0 AND t.typlen = -1)
  )
ORDER BY 1
