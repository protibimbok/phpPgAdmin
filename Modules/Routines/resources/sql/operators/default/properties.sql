SELECT op.oid, op.oprname as name,  ns.nspname as schema,
    pg_catalog.pg_get_userbyid(op.oprowner) as owner,
    op.oprcanhash as support_hash, op.oprcanmerge as support_merge,
    ns.nspname as schema,
    CASE WHEN op.oprkind = 'b' THEN 'infix'
      WHEN op.oprkind = 'l' THEN 'prefix'
      WHEN op.oprkind = 'r' THEN 'postfix'
    ELSE 'unknown' END as oprkind, pg_catalog.format_type(et.oid, NULL) as resulttype,
    pg_catalog.format_type(lt.oid, NULL) as lefttype,
    pg_catalog.format_type(rt.oid, NULL) as righttype,
    CASE WHEN co.oid IS NULL THEN NULL WHEN co.oprnamespace = op.oprnamespace THEN co.oprname
        ELSE 'OPERATOR(' || pg_catalog.quote_ident(cons.nspname) || '.' || co.oprname || ')' END as commutator, op.oprcode as operproc,
    CASE WHEN ne.oid IS NULL THEN NULL WHEN ne.oprnamespace = op.oprnamespace THEN ne.oprname
        ELSE 'OPERATOR(' || pg_catalog.quote_ident(nens.nspname) || '.' || ne.oprname || ')' END as negator, description,
    CASE WHEN op.oprrest = '-'::regproc THEN null ELSE op.oprrest END as restrproc,
    CASE WHEN op.oprjoin = '-'::regproc THEN null ELSE op.oprjoin END as joinproc
FROM pg_catalog.pg_operator op
    LEFT OUTER JOIN pg_catalog.pg_namespace ns ON ns.oid=op.oprnamespace
    LEFT OUTER JOIN pg_catalog.pg_type lt ON lt.oid=op.oprleft
    LEFT OUTER JOIN pg_catalog.pg_type rt ON rt.oid=op.oprright
    JOIN pg_catalog.pg_type et on et.oid=op.oprresult
    LEFT OUTER JOIN pg_catalog.pg_operator co ON co.oid=op.oprcom
    LEFT OUTER JOIN pg_catalog.pg_operator ne ON ne.oid=op.oprnegate
    LEFT OUTER JOIN pg_catalog.pg_namespace cons ON cons.oid=co.oprnamespace
    LEFT OUTER JOIN pg_catalog.pg_namespace nens ON nens.oid=ne.oprnamespace
    LEFT OUTER JOIN pg_catalog.pg_description des ON (des.objoid=op.oid AND des.classoid='pg_operator'::regclass)
WHERE op.oprnamespace = {{scid}}::oid
{% if opid %}    AND op.oid = {{opid}}::oid {% endif %}
ORDER BY op.oprname;
