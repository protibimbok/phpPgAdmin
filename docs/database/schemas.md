# Schemas

When you open a database, phpPgAdmin lands on its **Structure** tab: the list of the database's
schemas, where you create and drop them. The same level has the tab bar for everything else you can
do with the database, and the **Show create** tab with the database's DDL, statistics and
dependencies.

In phpMyAdmin a database holds tables directly. In PostgreSQL a database holds schemas, and the
schemas hold the tables, views, functions and types. Where phpMyAdmin shows a database's tables,
phpPgAdmin shows its schemas. Click a schema to reach [its tables](/schema/structure).

![The Structure tab of the bookshop database: four schemas with their actions, owner and comment, and the Create new schema card](/media/database/structure.png)

## The database tab bar

Every page inside a database shows these tabs, in this order:

| Tab | What it is for | Page |
| --- | --- | --- |
| **Structure** | The schema list (this page) | [Schemas](#the-schema-list) |
| **SQL** | Run SQL against the database | [SQL editor](/tools/sql) |
| **Search** | Search for a value across tables | [Search](/database/search) |
| **Export** | Dump the database or chosen schemas and tables | [Export](/tools/export) |
| **Import** | Run an SQL file or load CSV | [Import](/tools/import) |
| **Operations** | Comment, rename, copy, drop, owner, limits, maintenance | [Database operations](/database/operations) |
| **Privileges** | `GRANT`/`REVOKE` on the database and default privileges | [Privileges](/tools/privileges) |
| **Objects** | Extensions, languages, casts, event triggers, foreign data wrappers, servers and user mappings | [Extensions and other objects](/database/objects), [Foreign data](/database/foreign-data) |
| **Schema diff** | Compare two schemas and get the SQL that aligns them | [Schema diff](/database/schema-diff) |
| **Designer** | Draw tables and their foreign keys | [Designer](/database/designer) |
| **Show create** | The DDL that recreates the database | [Show create](#show-create) |

::: tip
At 1280 pixels wide the last tab is cut off at the right edge. Widen the window or collapse the
navigation panel to see **Show create**.
:::

## The schema list

The table has a row per schema:

| Column | What it shows |
| --- | --- |
| Checkbox | Selects the schema for **With selected** |
| **Schema** | The name, linking to the schema's [Structure tab](/schema/structure). `public` carries a **System** badge. |
| **Action** | **Structure** and **Browse** (both open the schema's table list), **Operations** (the [schema's Operations tab](/schema/operations)), **Drop** |
| **Owner** | The owning role. `public` is owned by `pg_database_owner` since PostgreSQL 15. |
| **Comment** | The schema's `COMMENT` |

The foot of the table counts the schemas. The system schemas `pg_catalog`, `information_schema`
and `pg_toast` are not listed.

::: info Browse goes to the table list
In phpMyAdmin **Browse** shows a table's rows. A schema has no rows, so here **Browse** opens the
same table list as **Structure**.
:::

### Create a schema

![The Create new schema card with Schema name, Owner and Create](/media/database/create-schema.png)

1. In **Create new schema**, type the **Schema name** (up to 63 characters).
2. Optionally pick an **Owner**. Leave it empty to make the role you signed in as the owner.
3. Click **Create**.

The form runs:

```sql
CREATE SCHEMA dbo_schema_a
    AUTHORIZATION bookshop_staff;
```

The card has no comment field. To add a comment, open the new schema's
[Operations tab](/schema/operations#comment) after you create it.

::: warning Names PostgreSQL refuses
Names starting with `pg_` are reserved: PostgreSQL answers *unacceptable schema name "pg_dbo"*.
A name that already exists fails with *schema "…" already exists*. Either error shows at the top
of the page and nothing is created.
:::

### Drop schemas

To drop one schema, click **Drop** in its row. To drop several, tick their checkboxes (or
**Check all**) and choose **Drop** from **With selected**. If nothing is ticked you get *No schemas
selected.*

A confirmation dialog shows the statements before they run, with one box:

![The drop confirmation for two schemas, with the CASCADE checkbox](/media/database/drop-schemas-confirm.png)

| Option | Effect | SQL |
| --- | --- | --- |
| *(default)* | Drops the schema only if it is empty | `DROP SCHEMA name;` |
| **Also drop the objects in it (CASCADE)** | Drops the schema with its tables, views, functions and everything that depends on them, in other schemas too | `DROP SCHEMA name CASCADE;` |

::: warning A schema with objects in it needs CASCADE
Without CASCADE, dropping a schema that still holds a table fails with *cannot drop schema … because
other objects depend on it*. With several schemas selected, the drops run one after another: the
schemas before a failing one stay dropped and the rest are not tried.
:::

::: danger
`CASCADE` follows dependencies out of the schema. A view in another schema that selects from a
dropped table is dropped too. Check the dependents first on the table's or schema's DDL page.
:::

## Print and Data dictionary

Under the schema list, as under phpMyAdmin's table list, **Print** prints the page and **Data
dictionary** opens phpMyAdmin's data dictionary (`/db/<database>/data-dictionary`): the database's
name and comment, a **Print** button, and for every table, partitioned table, partition, view,
materialized view and foreign table of every schema (as `schema.table`, schema by schema):

- its comment (**Table comments:**);
- its columns: **Column** (with *(Primary)* for a primary key column), **Type**, **Null**,
  **Default** (an identity or a generated column shows `GENERATED … AS IDENTITY` or its
  expression), **Links to** (the table and column a foreign key references, linked to that table's
  Structure page, when the table has foreign keys) and **Comments**;
- its indexes: **Keyname**, **Type** (the access method: BTREE, GIN, …), **Unique**, one row per
  **Column** (an expression index shows the expression, an `INCLUDE` column is marked), its
  **Collation** when not the default, **Null**, and the index's **Comment**; or *No index
  defined!*

`?schema=public` in the address limits it to one schema. When printed, the navigation panel and the
Print buttons are left out.

::: info Differences from phpMyAdmin
phpMyAdmin's *Packed* and *Cardinality* index columns have no PostgreSQL counterpart and are not
shown, nor is *Media type*. phpMyAdmin's data dictionary covers one database's tables; here a
database has schemas, so the tables are grouped by schema.
:::

## Show create

The **Show create** tab shows the database's DDL the way pgAdmin's SQL tab does, with two panels
below it.

![Show create for bookshop: the CREATE DATABASE statement, the Statistics panel and the Dependencies and Dependents panels](/media/database/show-create.png)

- **CREATE statements for &lt;database&gt;**: a commented `DROP DATABASE IF EXISTS`, then
  `CREATE DATABASE` with owner, encoding, collation and ctype, locale provider, tablespace,
  connection limit and template flag, then `COMMENT ON DATABASE`, any
  `ALTER DATABASE … SET parameter` settings, the `GRANT`s on the database and its default
  privileges. **Copy to clipboard** copies the text.
- **Statistics**: the database's `pg_stat_database` counters: size, backends, transactions
  committed and rolled back, blocks read and hit, tuples returned, fetched, inserted, updated and
  deleted. They are cumulative since the statistics were last reset.
- **Dependencies** and **Dependents**: what the database depends on and what depends on it in
  `pg_shdepend`. For a database both are usually empty.

::: info Database-level settings are shown but not edited here
`ALTER DATABASE … SET work_mem TO '8MB'` and similar per-database settings appear in the DDL, but
the Operations tab has no form for them. Run `ALTER DATABASE name SET parameter = value` in the
[SQL editor](/tools/sql). For settings per role and database, use the role's
[variables](/server/roles).
:::
