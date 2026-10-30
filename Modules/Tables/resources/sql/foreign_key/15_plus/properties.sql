SELECT ct.oid,
      conname as name,
      condeferrable,
      condeferred,
      confupdtype,
      confdeltype,
      CASE confmatchtype
        WHEN 's' THEN FALSE
        WHEN 'f' THEN TRUE
      END AS confmatchtype,
      conkey,
      confkey,
      confrelid,
      nl.nspname as fknsp,
      cl.relname as fktab,
      nr.oid as refnspoid,
      nr.nspname as refnsp,
      cr.relname as reftab,
      description as comment,
      {### phpPgAdmin: for the structure page ###}
      pg_catalog.pg_get_constraintdef(ct.oid, true) AS definition,
      convalidated,
      conislocal,
      {### PostgreSQL 15: ON DELETE SET NULL / SET DEFAULT (columns) ###}
      (SELECT pg_catalog.array_agg(a.attname ORDER BY k.i) FROM pg_catalog.unnest(ct.confdelsetcols) WITH ORDINALITY k(attnum, i)
        JOIN pg_catalog.pg_attribute a ON a.attrelid = ct.conrelid AND a.attnum = k.attnum) AS confdelsetcols
FROM pg_catalog.pg_constraint ct
JOIN pg_catalog.pg_class cl ON cl.oid=conrelid
JOIN pg_catalog.pg_namespace nl ON nl.oid=cl.relnamespace
JOIN pg_catalog.pg_class cr ON cr.oid=confrelid
JOIN pg_catalog.pg_namespace nr ON nr.oid=cr.relnamespace
LEFT OUTER JOIN pg_catalog.pg_description des ON (des.objoid=ct.oid AND des.classoid='pg_constraint'::regclass)
WHERE contype='f' AND
conrelid = {{tid}}::oid
-- Not the copies PostgreSQL makes of a key for each partition it references or is on.
AND ct.conparentid = 0
{% if cid %}
AND ct.oid = {{cid}}::oid
{% endif %}
ORDER BY conname
