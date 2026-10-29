# Foreign data

PostgreSQL reads tables in other databases and other systems through foreign data wrappers
(SQL/MED). phpPgAdmin manages the whole chain: **foreign data wrappers**, **foreign servers** and
**user mappings** on the database's [Objects tab](/database/objects), and **foreign tables** on a
schema's **Foreign tables** tab. This page walks through each, then a complete example that reads
`bookshop.public.authors` from another database.

The chain, and where each part lives:

| Object | What it is | Where |
| --- | --- | --- |
| Foreign data wrapper | The driver: `postgres_fdw`, `file_fdw`, `oracle_fdw`… Usually created by an extension. | Database → **Objects** → **Foreign data wrappers** |
| Foreign server | One remote source: host, port, database | Database → **Objects** → **Foreign servers** |
| User mapping | The credentials a local role uses on that server | Database → **Objects** → **User mappings** |
| Foreign table | A local table whose rows come from the server | Schema → **Foreign tables** |

The sections share the Objects tab's layout (Add, Edit, Export, Drop, with-selected Export and Drop,
CASCADE on drop), described in [How the sections work](/database/objects#how-the-sections-work).

## Option editors

Wrappers, servers, user mappings, foreign tables and foreign-table columns all take `OPTIONS`:
name/value pairs the wrapper defines. Each dialog has the same grid for them: an **Option** and a
**Value** per row, **Remove** per row, and **Add option** for a new row.

On Edit, phpPgAdmin compares the grid with the catalog and writes only the differences:

```sql
ALTER FOREIGN DATA WRAPPER dbo_fdw2
    OPTIONS (ADD level '2');
ALTER FOREIGN DATA WRAPPER dbo_fdw2
    OPTIONS (SET debug 'false');
ALTER FOREIGN DATA WRAPPER dbo_fdw2
    OPTIONS (DROP debug);
```

A row with neither name nor value is ignored. A value without a name, or the same option twice, is
refused before anything runs (*The option "level" is given twice.*). Which option names are valid
is decided by the wrapper's validator function: `postgres_fdw` rejects unknown names with *invalid
option "nonsense"*.

## Foreign data wrappers

Most wrappers come from an extension: add `postgres_fdw` or `file_fdw` under
[Extensions](/database/objects#add-an-extension) and the wrapper appears in this list with its
**Handler**, **Validator**, **Options** and **Owner**.

![The Foreign data wrappers list with postgres_fdw, its handler and validator](/media/database/fdw-list.png)

**Add foreign data wrapper** creates one by hand:

![The Add foreign data wrapper dialog with name, owner, handler, validator, an option and a comment](/media/database/fdw-dialog.png)

| Field | What it does | SQL |
| --- | --- | --- |
| **Name** | On Edit, renames it | `RENAME TO` |
| **Owner** | Empty for the current role | `OWNER TO` |
| **Handler function** | The function returning `fdw_handler` that does the work; **(none)** gives a wrapper that can hold servers and mappings but whose foreign tables cannot be queried | `HANDLER` / `NO HANDLER` |
| **Validator function** | Checks the options of the wrapper, its servers, mappings and tables; **(none)** accepts any option | `VALIDATOR` / `NO VALIDATOR` |
| **Options** | The wrapper's own options | `OPTIONS (…)` |
| **Comment** | | `COMMENT ON FOREIGN DATA WRAPPER` |

```sql
CREATE FOREIGN DATA WRAPPER dbo_fdw
    OPTIONS (debug 'true');

COMMENT ON FOREIGN DATA WRAPPER dbo_fdw
    IS 'A wrapper with no handler';
```

::: warning Superuser only
Creating or altering a wrapper needs a superuser. A wrapper that belongs to an extension should be
changed by updating or dropping the extension, not here.
:::

## Foreign servers

**Add foreign server** needs a wrapper; without one you get *Add a foreign data wrapper first: a
server belongs to one.*

![The Add foreign server dialog: wrapper postgres_fdw, name, type, version, host/port/dbname options and a comment](/media/database/server-dialog.png)

| Field | What it does |
| --- | --- |
| **Foreign data wrapper** | The wrapper the server uses; read-only on Edit |
| **Name** | On Edit, renames it |
| **Owner** | Empty for the current role |
| **Type**, **Version** | Free text that some wrappers read; `postgres_fdw` ignores them |
| **Options** | How the wrapper connects. For `postgres_fdw`: `host`, `port`, `dbname`, and connection settings such as `sslmode` or `fetch_size`. |
| **Comment** | |

```sql
CREATE SERVER dbo_bookshop
    TYPE 'postgresql'
    VERSION '18'
    FOREIGN DATA WRAPPER postgres_fdw
    OPTIONS (host 'localhost', port '5499', dbname 'bookshop');
```

::: warning Changing the type drops the server
PostgreSQL cannot alter a server's type, so a new **Type** makes the dialog run `DROP SERVER` and
`CREATE SERVER` (the Preview SQL starts with a warning). The drop has no CASCADE, so it fails with
*cannot drop server … because other objects depend on it* while user mappings or foreign tables use
the server, and nothing changes. The new server keeps the options, owner and comment. **Version**,
owner, options, name and comment are plain `ALTER`s.
:::

Dropping a server that has mappings or tables also fails without **CASCADE**; with it, the user
mappings and foreign tables go too.

## User mappings

A user mapping tells the wrapper which remote credentials a local role uses. **Add user mapping**
needs a server (*Add a foreign server first: a user mapping belongs to one.*).

![The Add user mapping dialog: server, user postgres, and user/password options](/media/database/user-mapping-dialog.png)

| Field | What it does |
| --- | --- |
| **Foreign server** | The server, shown as `server (wrapper)`; read-only on Edit |
| **User** | `CURRENT_USER`, `PUBLIC` (every role without a mapping of its own) or a role; read-only on Edit |
| **Options** | For `postgres_fdw`: `user` and `password` on the remote side |

```sql
CREATE USER MAPPING FOR postgres SERVER dbo_bookshop
    OPTIONS ("user" 'postgres', password 's3cret-docs');
```

On Edit only the options change. To map another role or server, add a new mapping and drop the old
one. The list names each mapping `role @ server`:

![The User mappings list: postgres @ dbo_bookshop with user 'postgres', password masked](/media/database/user-mappings.png)

::: info Passwords stay on the server
A `password` option never reaches the browser: the list shows it as `••••`, the **Edit** dialog
shows `xxxxxx` in a password field and **Export** writes `password 'xxxxxx'`. Leave the field as it
is to keep the stored password, or type a new one to replace it. PostgreSQL itself still shows
mapping options to the mapped role, the server's owner (if it has `USAGE`) and superusers through
`SELECT * FROM pg_user_mappings`, and an exported mapping needs its real password filled in before
it is run elsewhere.
:::

::: info postgres_fdw and passwords
For a role that is not a superuser, `postgres_fdw` requires a `password` in the mapping and that the
remote server actually asks for it; otherwise queries fail with *password is required*. A superuser
may connect without one, which is how the example below reads `bookshop` on a trust-authenticated
local cluster.
:::

## Foreign tables

A schema's **Foreign tables** tab (`/db/<database>/schema/<schema>/foreign-tables`) lists its
foreign tables with **Rows** (a **Browse** link), **Server**, **Columns**, **Options** and
**Comment**.

::: info Not in the schema's table list
Foreign tables are listed only on this tab. The schema's [Structure tab](/schema/structure) leaves
them out (a schema holding only foreign tables says *No tables found in schema.*).
:::

![The Foreign tables list with dbo_authors on server dbo_bookshop, its columns and options](/media/database/foreign-tables.png)

### Add a foreign table

![The Add foreign table dialog: name, owner, server, schema_name/table_name options, comment and four columns](/media/database/foreign-table-dialog.png)

| Field | What it does |
| --- | --- |
| **Name** | The local table name |
| **Owner** | Empty for the current role |
| **Foreign server** | Read-only on Edit. Without any server the hint says to add one on the Objects tab. |
| **Options** | Where the wrapper finds the rows. For `postgres_fdw`: `schema_name` and `table_name` (default: the local names). |
| **Comment** | |
| **Columns** | A row per column: **Name**, **Type** (with suggestions for common types; any type name works), **Not null**, **Default**, and column **Options** (for `postgres_fdw`, `column_name` maps a local column to a differently named remote one). **Add column** adds a row; **Remove** deletes one. |

The columns do not have to match the remote table one to one: you can leave remote columns out, and
`postgres_fdw` matches by name (or `column_name`), not by position.

::: info Constraints are not checked
`NOT NULL` and defaults on a foreign table are declarations for the planner and for `INSERT`s
through the table; PostgreSQL does not verify that the remote rows obey them.
:::

### Edit columns

On Edit, phpPgAdmin compares the grid with the table's current columns and writes one `ALTER`
per change, in this order: rename and owner of the table, dropped columns, then per kept column
`DROP`/`SET NOT NULL`, `TYPE`, `SET`/`DROP DEFAULT`, `RENAME COLUMN` and its `OPTIONS`, then added
columns:

```sql
ALTER FOREIGN TABLE IF EXISTS public.dbo_authors
    RENAME TO dbo_authors2;
ALTER FOREIGN TABLE IF EXISTS public.dbo_authors2
    OWNER TO bookshop_staff;
ALTER FOREIGN TABLE public.dbo_authors2
    DROP COLUMN id;
ALTER FOREIGN TABLE public.dbo_authors2
    ALTER COLUMN name DROP NOT NULL;
ALTER FOREIGN TABLE public.dbo_authors2
    ALTER COLUMN born TYPE text;
ALTER FOREIGN TABLE public.dbo_authors2
    ALTER COLUMN born SET DEFAULT 'unknown';
ALTER FOREIGN TABLE public.dbo_authors2
    RENAME COLUMN country TO country_code;
ALTER FOREIGN TABLE public.dbo_authors2
    ALTER COLUMN country_code OPTIONS (ADD column_name 'country');
ALTER FOREIGN TABLE public.dbo_authors2
    ADD COLUMN bio text;
```

These change only the local definition. The remote table is never altered.

Columns a foreign table inherits from a parent table are left out of the grid.

### Browse

**Browse** opens the schema's [SQL tab](/tools/sql) and runs `SELECT * FROM schema.table;`, so you
get the usual result grid, with paging, export and the rest. Each page of results is a query on the
remote server.

### Drop

**Drop** runs `DROP FOREIGN TABLE schema.table;` (with **CASCADE**, also dropping views on it). The
remote table is untouched.

## Worked example: read bookshop from another database

This reads `public.authors` of the `bookshop` database from a scratch database `dbo_scratch` on the
same cluster (port 5499), as the superuser `postgres`.

1. **Install the wrapper.** In `dbo_scratch`, open **Objects** → **Add extension**, choose
   `postgres_fdw`, click **Go**. The **Foreign data wrappers** list now shows `postgres_fdw`.
2. **Add the server.** **Add foreign server**, wrapper `postgres_fdw`, name `dbo_bookshop`, options
   `host` = `localhost`, `port` = `5499`, `dbname` = `bookshop`. **Go**.
3. **Add the user mapping.** **Add user mapping**, server `dbo_bookshop (postgres_fdw)`, user
   `postgres`, option `user` = `postgres` (and `password` if the remote server asks for one).
   **Go**.
4. **Add the foreign table.** Open the `public` schema's **Foreign tables** tab, **Add foreign
   table**: name `dbo_authors`, server `dbo_bookshop`, options `schema_name` = `public`,
   `table_name` = `authors`, and columns `id integer` (not null), `name text` (not null),
   `born date`, `country character(2)`. **Go**.
5. **Browse it.** Click **Browse** in the table's row.

![The SQL tab after Browse: SELECT * FROM public.dbo_authors returning eight authors from bookshop](/media/database/foreign-table-browse.png)

The rows come from `bookshop` at query time. To import every table of a remote schema at once, run
`IMPORT FOREIGN SCHEMA public FROM SERVER dbo_bookshop INTO local_schema;` in the
[SQL editor](/tools/sql); there is no form for it.

## Limitations

- **Privileges**: there is no editor for `GRANT USAGE ON FOREIGN DATA WRAPPER` or
  `GRANT USAGE ON FOREIGN SERVER`; a role that is not the owner needs `USAGE` on the server to
  create mappings and foreign tables. Run the `GRANT` in the [SQL editor](/tools/sql). Foreign
  tables are covered: they appear in the schema's [Privileges](/tools/privileges) tab and grant
  wizard.
- `IMPORT FOREIGN SCHEMA`, foreign-table constraints (`CHECK`), partitions of a partitioned table
  that are foreign tables, and security labels have no form.
