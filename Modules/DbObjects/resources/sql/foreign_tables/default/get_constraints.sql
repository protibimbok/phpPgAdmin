SELECT
    oid as conoid, conname, contype,
    {### phpPgAdmin: the expression as the check constraint templates read it, not the definition with every bracket trimmed from its ends ###}
    pg_catalog.pg_get_expr(conbin, conrelid, true) as consrc,
    connoinherit, convalidated, conislocal
FROM
    pg_catalog.pg_constraint
WHERE
    conrelid={{foid}}::oid AND contype = 'c'
ORDER by conname;
