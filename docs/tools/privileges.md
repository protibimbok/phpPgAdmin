# Privileges

The **Privileges** tab grants and revokes PostgreSQL privileges on one object. It is on every
database (after **Operations**), every schema (after **Operations**) and every table, view and
materialized view (before **Operations**). Database and schema pages also hold the
**Default privileges** for objects created later, and a schema's page has the **Grant wizard** for
many objects at once. Tablespaces have the same panel on their
[own page](/server/tablespaces#privileges), and sequences, functions, procedures, types and domains
below their editor's form: the **Privileges** link of each row on the
[Sequences](/schema/sequences#privileges), [Routines](/schema/routines#privileges) and
[Types](/schema/types) lists opens it. Languages, foreign data wrappers, foreign servers and
foreign tables open theirs in a dialog from the **Privileges** link of their row on the
[Objects](/database/objects#how-the-sections-work) and [Foreign tables](/database/foreign-data#privileges)
pages. The layout follows phpMyAdmin's database Privileges tab.

## Roles having access

The panel lists every grantee of the object, read from its ACL with the built-in defaults filled in,
so what the owner and `PUBLIC` hold implicitly shows too.

![The Privileges tab of bookshop: PUBLIC, the owner and a scratch role](/media/server/privileges-database.png)

| Column | What it shows |
|---|---|
| **Role** | The grantee; `PUBLIC` (every role) in red; *(owner)* after the owner. |
| **Type** | *database-specific*, *schema-specific*, *table-specific*, *view-specific*, *materialized view-specific*, *foreign table-specific*, *sequence-specific*, *routine*, *type-specific*, *domain-specific*, *tablespace-specific*, *language-specific*, *foreign data wrapper-specific*, *foreign server-specific*, or **Column:** *name* for a column grant. |
| **Privileges** | The privileges held, or **ALL PRIVILEGES** when it holds every one the object accepts. |
| **Grant** | **No**, or the privileges it holds `WITH GRANT OPTION` (it may grant them on). |
| **Granted by** | The grantor(s). |
| **Edit privileges**, **Revoke** | Change this grantee's privileges, or revoke them all. |

## Grant privileges

1. Under **New**, click **Add privileges for a role**.
2. Choose the **Role:**, or `PUBLIC`. If the role already holds privileges here, the checkboxes start
   from them.
3. Check the privileges. The second checkbox of each row adds `WITH GRANT OPTION`. **Check all** in
   the legend checks every privilege.
4. **Preview SQL** shows the statements; **Go** runs them. The list updates and the message is
   *The privileges of role have been updated.*

![The privileges dialog for a database](/media/server/privileges-dialog.png)

The dialog above runs:

```sql
GRANT CONNECT ON DATABASE bookshop TO srv_priv_reader;

GRANT TEMPORARY ON DATABASE bookshop TO srv_priv_reader WITH GRANT OPTION;
```

**Edit privileges** opens the same dialog for one grantee. phpPgAdmin compares what you check with
what the role holds and writes only the difference, as `GRANT` for what was added and `REVOKE` for
what was removed (`REVOKE CONNECT ON DATABASE bookshop FROM srv_priv_reader;`). **Revoke** asks,
showing the `REVOKE`, and removes everything the grantee holds on the object.

### Privileges each object accepts

| Object | Privileges offered |
|---|---|
| Database | `CREATE`, `CONNECT`, `TEMPORARY` |
| Schema | `USAGE`, `CREATE` |
| Table, view, materialized view, foreign table | `INSERT`, `SELECT`, `UPDATE`, `DELETE`, `TRUNCATE`, `REFERENCES`, `TRIGGER`, `MAINTAIN` (PostgreSQL 17+) |
| Column | `INSERT`, `SELECT`, `UPDATE`, `REFERENCES` |
| Sequence | `USAGE`, `SELECT`, `UPDATE` |
| Function, procedure | `EXECUTE` |
| Type, domain | `USAGE` |
| Tablespace | `CREATE` |
| Language, foreign data wrapper, foreign server | `USAGE` |

Hover a privilege for what it allows.

::: info Revoking from PUBLIC
Every role is a member of `PUBLIC`. Revoking a privilege from one role does not remove what it gets
through `PUBLIC`: `bookshop`'s `PUBLIC` row (`CONNECT, TEMPORARY`, the built-in default for
databases) still lets every role connect. Revoke from `PUBLIC` to close that.
:::

::: warning Only owners and grant holders may grant
PostgreSQL lets the owner, a superuser, or a role holding the privilege `WITH GRANT OPTION` grant it.
When a superuser grants on an object owned by someone else, the grant is recorded as made by the
owner, so **Granted by** shows the owner.
:::

## Column privileges

On a table or view the panel also lists column grants, one row per column and grantee
(**Column:** *name*), and **New** has **Add column privileges**:

1. Click **Add column privileges**.
2. Choose the **Column**, then the **Role:**.
3. Check `INSERT`, `SELECT`, `UPDATE` or `REFERENCES` and click **Go**.

```sql
GRANT SELECT (name), UPDATE (name) ON TABLE srv_priv_schema.srv_priv_tbl TO srv_priv_reader;
```

![A table's grantees with a column grant](/media/server/privileges-table.png)

**Revoke** on a column row revokes only that column's privileges
(`REVOKE SELECT (name), UPDATE (name) ON TABLE … FROM srv_priv_reader;`).

::: info Table privileges include every column
A role with `SELECT` on the table can read all columns, whatever the column grants say. To limit a
role to some columns, grant on those columns only and not on the table.
:::

## Default privileges

The **Default privileges** fieldset (database page) and **Default privileges in this schema**
(schema page) manage `ALTER DEFAULT PRIVILEGES`: the privileges objects get when they are created
later. Existing objects are not changed.

Each row: **For objects created by** (the role whose new objects it applies to), **Objects**
(*tables*, *sequences*, *functions*, *types*, and *schemas* on the database page only), the grantee
**Role**, the **Privileges**, **Grant**, and **Edit privileges** / **Revoke**. With no rows, new
objects get the built-in defaults (the owner holds everything; `PUBLIC` gets `EXECUTE` on functions
and `USAGE` on types).

To add one:

1. Click **Add default privileges**.
2. **For objects created by**: a role, or **(current role)**.
3. **Objects**: the kind.
4. **Role:** the grantee, then the privileges, and **Go**.

```sql
ALTER DEFAULT PRIVILEGES FOR ROLE srv_priv_writer GRANT SELECT ON TABLES TO srv_priv_reader;
```

On the schema page the statement gets `IN SCHEMA name`.

![The default privileges for tables created by srv_priv_writer](/media/server/privileges-defaults.png)

A table `srv_priv_writer` creates afterwards starts with
`srv_priv_reader=r/srv_priv_writer` in its ACL.

::: warning Defaults follow the creating role, not you
A default privilege applies only to objects created by the role in **For objects created by**. If
tables are created by a migration role, add the defaults for that role, not for yourself. Setting
defaults for another role requires being a member of it (or a superuser).
:::

::: info The owner's row
Once a default exists for a role and kind, PostgreSQL stores the owner's own privileges with it, so
the list shows a second row for the creating role itself. Revoking the other grantee's row removes
the whole entry again when nothing differs from the built-in defaults.
:::

## Grant wizard

A schema's Privileges tab ends with pgAdmin's **Grant wizard**, which grants on many objects of the
schema in one run:

![The grant wizard with every scratch object checked](/media/server/privileges-wizard.png)

1. In **Objects**, check the tables, partitioned tables, views, materialized views, foreign
   tables, sequences, functions and procedures to grant on. The search box filters the list;
   the **Objects** checkbox checks every object shown.
2. Choose the **Role:** (or `PUBLIC`).
3. Check the privileges. Only privileges at least one checked object accepts are offered; each object
   gets the ones it accepts (`EXECUTE` on routines, `USAGE` on sequences, and so on).
   **WITH GRANT OPTION** applies to all of them.
4. **Preview SQL**, then **Go** and confirm.

```sql
GRANT SELECT, USAGE ON SEQUENCE srv_priv_schema.srv_priv_seq TO srv_priv_reader;

GRANT SELECT ON TABLE srv_priv_schema.srv_priv_tbl TO srv_priv_reader;

GRANT SELECT ON TABLE srv_priv_schema.srv_priv_view TO srv_priv_reader;

GRANT EXECUTE ON FUNCTION srv_priv_schema.srv_priv_fn() TO srv_priv_reader;
```

The wizard only adds privileges; ones already held are kept and not repeated (above, a fifth checked
table where the role already had `SELECT` got no statement). The message counts the objects that got a
statement: *… on 4 objects*. Use each object's Privileges tab to revoke. Without a role, **Go** says
*Choose a role to grant the privileges to.*

## See also

- [Roles](/server/roles#database-specific-privileges): the databases a role holds privileges on.
- [Tablespaces](/server/tablespaces#privileges): `CREATE` on a tablespace.
- [Triggers, rules and policies](/table/triggers): row-level security, which restricts rows within the
  privileges granted here.
