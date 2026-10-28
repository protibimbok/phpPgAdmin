SELECT  sub.oid as oid,
        subname as name,
        subpublications as pub,
        sub.subsynccommit as sync,
        pga.rolname as subowner,
        subslotname as slot_name,
        subenabled as enabled,
        subbinary as binary,
        substream as streaming,
        subtwophasestate as two_phase,
        subdisableonerr as disable_on_error,
        subpasswordrequired as password_required,
        subrunasowner as run_as_owner,
        suborigin as origin,
        subfailover as failover,
        {% if conninfo_visible %}sub.subconninfo{% else %}NULL{% endif %} as conninfo,
        pg_catalog.obj_description(sub.oid, 'pg_subscription') as description
FROM pg_catalog.pg_subscription sub join pg_catalog.pg_roles pga on sub.subowner= pga.oid
WHERE
{% if subid %}
    sub.oid = {{ subid }}
{% else %}
    sub.subdbid = {{ did }}
{% endif %}
ORDER BY sub.subname
