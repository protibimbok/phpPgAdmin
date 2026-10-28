SELECT prel.prrelid AS tid,
    pg_catalog.quote_ident(n.nspname) || '.' || pg_catalog.quote_ident(cls.relname) AS table_name,
	(SELECT pg_catalog.json_agg(pg_catalog.quote_ident(attname) ORDER BY attnum) FROM pg_catalog.pg_attribute att WHERE attrelid = prel.prrelid AND attnum = ANY (prel.prattrs)) AS columns,
	pg_catalog.pg_get_expr(prel.prqual, prel.prrelid) AS where
	FROM pg_catalog.pg_publication_rel prel
	JOIN pg_catalog.pg_class cls ON cls.oid = prel.prrelid
	JOIN pg_catalog.pg_namespace n ON cls.relnamespace = n.oid WHERE prel.prpubid = {{pbid}} :: oid
ORDER BY 2;
