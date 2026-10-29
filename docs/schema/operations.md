# Schema operations

A schema's **Operations** tab (`/db/<database>/schema/<schema>/operations`) changes the schema
itself: its comment, its name, its owner, dropping it, and maintenance on all of its tables. Reach it
from the tab bar inside a schema, or with **Operations** in the schema's row on the database's
[Structure tab](/database/schemas#the-schema-list).

![The Operations tab of a scratch schema: the comment, rename, remove, properties and maintenance cards](/media/database/schema-operations.png)

Each form card has **Preview SQL**, which shows the statements without running them, and **Go**.
Clicking **Go** with nothing changed says *Nothing to change.*

## Comment

**Schema comment** sets the description shown in the schema list.

```sql
COMMENT ON SCHEMA dbo_schema
    IS 'Renamed scratch schema';
```

Clear the field and click **Go** to remove it.

## Rename

**Rename schema to** runs:

```sql
ALTER SCHEMA dbo_schema
    RENAME TO dbo_schema_renamed;
```

The page then moves to the renamed schema's Operations tab and the navigation panel refreshes.

::: warning What a rename does not change
Objects inside the schema move with it, but code that names the schema does not: function bodies,
`search_path` settings of roles, databases and functions, and application queries still use the
old name. Views and foreign keys are stored by OID and follow the rename. As when creating a
schema, names starting with `pg_` are refused.
:::

## Remove schema

**Remove schema** has two links, each opening a confirmation dialog with the statement:

| Link | SQL | Works when |
| --- | --- | --- |
| **Drop the schema (DROP)** | `DROP SCHEMA "name";` | The schema is empty |
| **Drop the schema and everything in it (DROP … CASCADE)** | `DROP SCHEMA "name" CASCADE;` | Always (if you own it) |

![The confirmation for DROP SCHEMA … CASCADE](/media/database/schema-drop-cascade.png)

A plain drop of a schema that holds a table fails with *cannot drop schema … because other objects
depend on it* and nothing changes. After a successful drop you land on the database's Structure tab.

::: danger
`CASCADE` also drops objects outside the schema that depend on what is in it, such as a view in
another schema. The `public` schema has the same links and no extra protection, so read the
statement in the dialog before you confirm.
:::

## Schema properties

**Schema properties** changes the **Owner**:

```sql
ALTER SCHEMA dbo_schema
    OWNER TO bookshop_staff;
```

Changing a schema's owner does not change the owners of the tables and other objects in it. To hand
over everything a role owns, use `REASSIGN OWNED BY old_role TO new_role` in the
[SQL editor](/tools/sql).

::: info The public schema's owner
Since PostgreSQL 15, `public` is owned by `pg_database_owner`, a role that stands for whoever owns
the database. The **Owner** list shows it for `public`; keep it unless you have a reason to change
it.
:::

## Privileges and default privileges

The Operations tab does not edit privileges. `GRANT USAGE` / `CREATE` on the schema and the
default privileges for objects created in it (`ALTER DEFAULT PRIVILEGES IN SCHEMA …`) are on the
schema's **Privileges** tab, described on the [Privileges](/tools/privileges) page.

## Maintenance

The **Maintenance** card runs `VACUUM`, `ANALYZE` or `REINDEX` on every table and materialized view
in the schema, as a background process. `CLUSTER` is offered on the database's card only. See
[Maintenance](/tools/maintenance) for the options.

## What there is not

phpMyAdmin's database Operations page has a **Copy database to** card. PostgreSQL has no statement
that copies a schema, and the schema's Operations tab has no copy card. To copy a schema, export it
from the schema's [Export tab](/tools/export), rename the schema in the file (or rename the original
first) and import it again.
