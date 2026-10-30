SELECT
    c.oid, c.relname AS name, pg_catalog.pg_get_userbyid(relowner) AS owner,
    pg_catalog.array_to_string(c.relacl::text[], ', ') as acl,
    ftoptions, srvname AS ftsrvname, description, nspname AS basensp,
    (SELECT count(*) FROM pg_catalog.pg_trigger WHERE tgrelid=ftrelid AND tgisinternal = FALSE) AS triggercount,
    (SELECT
        pg_catalog.array_agg(provider || '=' || label)
    FROM
        pg_catalog.pg_seclabel sl1
    WHERE
        sl1.objoid=c.oid) AS seclabels,
    {### phpPgAdmin: a partition's parent and bound, which CREATE FOREIGN TABLE … PARTITION OF writes ###}
    c.relispartition AS is_partition,
    CASE WHEN c.relispartition THEN pg_catalog.pg_get_expr(c.relpartbound, c.oid) END AS partition_bound,
    (SELECT
        pg_catalog.quote_ident(pn.nspname) || '.' || pg_catalog.quote_ident(p.relname)
    FROM
        pg_catalog.pg_inherits i
        JOIN pg_catalog.pg_class p ON p.oid = i.inhparent
        JOIN pg_catalog.pg_namespace pn ON pn.oid = p.relnamespace
    WHERE
        c.relispartition AND i.inhrelid = c.oid) AS partition_of
    {% if foid %},
    (SELECT
        pg_catalog.array_agg(i.inhparent) FROM pg_catalog.pg_inherits i
    WHERE
        i.inhrelid = {{foid}}::oid GROUP BY i.inhrelid) AS inherits
    {% endif %}
FROM
    pg_catalog.pg_class c
JOIN
    pg_catalog.pg_foreign_table ft ON c.oid=ft.ftrelid
LEFT OUTER JOIN
    pg_catalog.pg_foreign_server fs ON ft.ftserver=fs.oid
LEFT OUTER JOIN
    pg_catalog.pg_description des ON (des.objoid=c.oid AND des.classoid='pg_class'::regclass AND des.objsubid = 0)
LEFT OUTER JOIN
    pg_catalog.pg_namespace nsp ON (nsp.oid=c.relnamespace)
WHERE
    c.relnamespace = {{scid}}::oid
    {% if foid %}
    AND c.oid = {{foid}}::oid
    {% endif %}
ORDER BY c.relname;
