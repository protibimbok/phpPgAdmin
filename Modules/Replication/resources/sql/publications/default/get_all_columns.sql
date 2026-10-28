SELECT
  pg_catalog.quote_ident(attname) as column
FROM pg_catalog.pg_attribute
WHERE
  attrelid = {{ tid }} :: oid
  and attnum > 0
  and NOT attisdropped
ORDER BY attnum;
