# Export

The **Export** tab writes a dump of what you are looking at: the whole server with `pg_dumpall`, or a
database, a schema or a single table, view or materialized view with `pg_dump`. CSV is written by
`COPY` through `psql`. The tab sits on every level — server, database, schema and relation — and is laid out
like phpMyAdmin's export page: templates, **Export method**, **Format**, what to export, **Output** and
the format's options.

![The database Export tab in Quick mode: templates, export method, format and the Export button](/media/tools/export-quick.png)

The dump is not written by PHP. The web server runs PostgreSQL's own client programs and streams their
output to your browser, so the file you get is exactly what `pg_dump` would have written on the command
line, and it can be restored with `psql` or `pg_restore`, or on the [Import](/tools/import) tab.

::: warning The client programs must be on the web server
Export needs `pg_dump` and `pg_dumpall` (and `psql` for CSV) on the machine that runs phpPgAdmin. By
default the newest ones found are used: on the `PATH`, in `/usr/lib/postgresql/<major>/bin`,
`/usr/pgsql-<major>/bin`, Homebrew's `postgresql@<major>/bin`, `/usr/local/pgsql/bin`, `/usr/bin` and
`/usr/local/bin`. To pin a directory, set `PGADMIN_PG_BIN_DIR` (the `bin_dir` entry of
`config/tools.php`, see [Configuration](/guide/configuration)).

When no `pg_dump` is found, the page shows *pg_dump was not found on the web server…* in red and
**Export** does nothing else.
:::

::: warning pg_dump must be at least as new as the server
`pg_dump` refuses to dump a server newer than itself. When the programs found are older than the
server's major version the page says *pg_dump 16.4 cannot export from a PostgreSQL 18 server* and
refuses the export (HTTP 422). Install the client package of the server's version, or newer, and
point `PGADMIN_PG_BIN_DIR` at it. CSV exports are not affected: `COPY` through an older `psql` works.
:::

## Quick and Custom

- **Quick - display only the minimal options** exports with `pg_dump`'s defaults: everything in the
  scope, structure and data, uncompressed, to a file named after the scope (`localhost.sql`,
  `bookshop.sql`, `public.sql`, `authors.sql`). Only **Format** can be changed.
- **Custom - display all possible options** shows the selection, **Output** and
  **Format-specific options** cards described below.

The method, format and compression the page starts with are your preferences on the Export settings
page ([Settings](/server/settings)).

::: info Quick ignores the compression and file-name preferences
In Quick mode only the scope and the format are sent, so the file is never gzipped and is named after
the default template, whatever your saved compression or file-name template says.
:::

## Formats

| Format | Program | File | Offered at |
| --- | --- | --- | --- |
| **SQL** | `pg_dumpall` (server) or `pg_dump --format=plain` | `.sql` | every level |
| **PostgreSQL custom archive (pg_restore)** | `pg_dump --format=custom` | `.dump` | database, schema, relation |
| **PostgreSQL tar archive (pg_restore)** | `pg_dump --format=tar` | `.tar` | database, schema, relation |
| **CSV** | `psql` running `COPY … TO STDOUT (FORMAT csv)` | `.csv` | database, schema, relation |
| **CSV for MS Excel** | the same, every value quoted, CRLF line ends | `.csv` | database, schema, relation |

The server level offers SQL only: `pg_dumpall` writes plain SQL and nothing else. The directory
format of `pg_dump` is not offered, because a directory cannot be streamed as one download.

::: tip Which format to pick
Plain SQL is readable and restores with `psql`, but must be restored whole and in order. A custom
archive restores with `pg_restore`, which can pick objects, skip owners and privileges, and run in
parallel; it is the format to use for backups. Tar holds the same as custom, in a tar file.
:::

## What to export

### Server: databases

At the server level, **Custom** shows a **Databases** list with **Select all** and **Unselect all**.
`pg_dumpall` always dumps every database it can connect to; the ones you leave unselected are passed as
`--exclude-database`. `template0` is never listed.

![The Databases card of the server export with only bookshop selected](/media/tools/export-server-databases.png)

The **Dump:** choice under the format options picks what of the cluster goes in:

| Option | pg_dumpall flag |
| --- | --- |
| **roles, tablespaces and databases** | (none) |
| **roles and tablespaces only** | `--globals-only` |
| **roles only** | `--roles-only` |
| **tablespaces only** | `--tablespaces-only` |

and **Dump databases:** chooses **structure** (`--schema-only`), **data** (`--data-only`) or
**structure and data**.

::: warning A server export contains role password hashes
`pg_dumpall` writes `ALTER ROLE … PASSWORD 'SCRAM-SHA-256$…'` for every role with a password. Treat the
file as a secret, or switch off **Add role passwords** (`--no-role-passwords`).
:::

### Database: schemas, and schema: tables

At the database level the card is **Schemas:**, at the schema level **Tables:** (tables, views,
materialized views, foreign tables and standalone sequences; partitions come with their partitioned
table, and a sequence owned by a column comes with its table). Each row has a **Structure** and a
**Data** box, and the first column ticks both. A view has no **Data** box.

![The Tables card of the public schema with the data of books left out](/media/tools/export-schema-tables.png)

phpMyAdmin picks structure and data per table. `pg_dump` dumps one set of objects with or without
their rows, so the boxes are mapped onto its options:

| What you tick | What runs |
| --- | --- |
| Every box | `pg_dump` of the whole database (`--schema=` for a schema), extensions, publications and event triggers included |
| Some rows, both boxes | `--schema=…` per schema, or `--table=…` per relation |
| Structure everywhere, Data on some | the rows of the others left out with `--exclude-table-data=…` |
| No Data box at all | `--schema-only` |
| No Structure box at all | `--data-only` |

A partitioned table is selected with `--table-and-children` and its rows excluded with
`--exclude-table-data-and-children` (`pg_dump` 16 or newer), so its partitions follow it.

::: warning Data without its structure is refused
Ticking **Data** without **Structure** for one table while other tables have both is the one
combination `pg_dump` cannot write. The export stops with *pg_dump cannot export the data of "authors"
without its structure in a dump that has structure; export it separately with only "Data" ticked.*

![The error shown when a table's data is ticked without its structure](/media/tools/export-orphan-error.png)
:::

::: info A chosen subset leaves out what lies outside the schemas
When not every schema (or every relation of a schema) is ticked, the dump is narrowed with `--schema`
or `--table`. Functions, types and the other objects of a schema come along with `--schema`; with
`--table` only the chosen relations and what they own (their sequences, indexes, constraints,
triggers) are dumped. Extensions are only in a whole-database dump.
:::

**With selected: Export** on a schema's [Structure](/schema/structure) page opens this page with the
ticked tables preselected (`?table=authors&table=books` in the address) and **Custom** chosen.

### Relation

On a table, view or materialized view **Dump table:** chooses **structure**, **data** or
**structure and data**. A partitioned table takes its partitions along; a view's export is its
`CREATE VIEW`.

## Output

![The Output card: view as text or save to a file, file name template, character set and compression](/media/tools/export-output.png)

- **View output as text** runs the export and shows it in a text box under the form instead of
  downloading it. It is meant for a quick look; the whole output is loaded into the page.
- **Save output to a file** downloads the dump while it is written. Nothing is held in memory or on
  disk on the web server.

| Field | What it does |
| --- | --- |
| **File name template:** | `@SERVER@`, `@DATABASE@`, `@SCHEMA@` and `@TABLE@` become the names, `strftime` conversions (`%Y`, `%m`, `%d`, `%H`, `%M`, `%S`, …) the time. The extension is added. `/`, `\`, `:` and other characters a file system dislikes become `_`. |
| **Use this for future exports** | remembers the template for that level in this browser (local storage) |
| **Character set of the file:** | `--encoding` for `pg_dump`, `ENCODING` for `COPY` |
| **Compression:** | **None**, or **gzipped** |
| **Skip the data of tables larger than:** | in MiB, indexes and TOAST included (`pg_total_relation_size`); the rows of larger tables are left out with `--exclude-table-data` (database, schema and relation levels) |

For example `@SERVER@-@DATABASE@-@SCHEMA@-@TABLE@-%Y%m%d` downloads
`localhost-bookshop-public-authors-20261029.sql`.

### Compression

| Format | gzipped gives |
| --- | --- |
| SQL, tar, CSV | the output gzipped on the fly: `bookshop.sql.gz`, `bookshop.tar.gz`, `authors.csv.gz` |
| Custom archive | `pg_dump --compress=gzip`: the archive's own compression, still `bookshop.dump` |

::: info A custom archive is uncompressed by default
With **Compression: None** a custom archive is written with `--compress=0`, unlike `pg_dump`'s own
default. Choose **gzipped** for a compressed archive (the `bookshop` archive went from 171 KB to 83 KB).
:::

## SQL and archive options

**Format-specific options** shows `pg_dump`'s (or `pg_dumpall`'s) options. Switches that do not apply
to the current choice are hidden: the structure options when only data is exported, the data options
when only structure is, the plain-SQL-only ones for an archive.

![The format-specific options of a server export](/media/tools/export-server-options.png)

### General

| Option | Flag |
| --- | --- |
| **Additional custom header comment (\n splits lines):** | written as `--` lines before the dump (plain SQL only) |
| **Wait for a `SERIALIZABLE, READ ONLY, DEFERRABLE` snapshot** | `--serializable-deferrable` (not on the server level) |
| **Enclose all identifiers in double quotes** | `--quote-all-identifiers` |
| **Quote function bodies as standard strings instead of with dollar quoting** | `--disable-dollar-quoting` |

### Object creation options

| Option | Flag | Notes |
| --- | --- | --- |
| **Add `CREATE DATABASE` / `\connect` statement** | `--create` | database level, plain SQL |
| **Add `DROP` statements before the objects are created** | `--clean` | plain SQL; **`IF EXISTS`** adds `--if-exists` |
| **Add `ALTER … OWNER TO` statements** | off: `--no-owner` | plain SQL |
| **Use `SET SESSION AUTHORIZATION` instead** | `--use-set-session-authorization` | plain SQL |
| **Add `GRANT` / `REVOKE` statements** | off: `--no-privileges` | |
| **Add `COMMENT ON` statements** | off: `--no-comments` | |
| **Add tablespace assignments** | off: `--no-tablespaces` | |
| **Add `SECURITY LABEL` statements** | off: `--no-security-labels` | |
| **Add `CREATE POLICY` statements** | off: `--no-policies` | `pg_dump` 18 or newer |
| **Add `CREATE PUBLICATION` statements** | off: `--no-publications` | server and database |
| **Add `CREATE SUBSCRIPTION` statements** | off: `--no-subscriptions` | server and database |
| **Add role passwords** | off: `--no-role-passwords` | server |
| **Add the planner statistics** | `--statistics` | `pg_dump` 18 or newer, structure and data |

::: danger Create and Drop together drop the database
With both **Add `CREATE DATABASE`** and **Add `DROP` statements** the dump begins with
`DROP DATABASE IF EXISTS bookshop;`. Running that file with `psql` drops the database before
recreating it.
:::

For an archive, owner, `CREATE DATABASE`, `DROP` and `SET SESSION AUTHORIZATION` are not offered:
`pg_dump` always records them in an archive and `pg_restore` decides when you restore (see
[Import](/tools/import#archives)).

### Data creation options

| Option | Flag |
| --- | --- |
| **Disable triggers while the data is loaded** | `--disable-triggers` (data-only dumps; restoring needs a superuser) |
| **Dump the data of unlogged tables** | off: `--no-unlogged-table-data` |
| **Dump large objects** | `--large-objects` / off: `--no-large-objects` (database and schema) |
| **Load partitions through the partitioned table** | `--load-via-partition-root` |
| **Function to use when dumping data:** | **COPY** (default) or **INSERT** |

With **INSERT**, **`INSERT … ON CONFLICT DO NOTHING` statements** (`--on-conflict-do-nothing`) and
**Syntax to use when inserting data:** appear:

| Syntax | Flags |
| --- | --- |
| **include column names in every `INSERT` statement** | `--column-inserts` |
| **insert multiple rows in every `INSERT` statement** | `--rows-per-insert=N` |
| **both of the above** | `--column-inserts --rows-per-insert=N` |
| **neither of the above** | `--inserts` |

**Rows in each INSERT statement:** is the `N` (100 by default).

![View output as text with INSERT statements that include column names](/media/tools/export-as-text.png)

## CSV

CSV is data only, as in phpMyAdmin: the **Structure** column disappears from the selection card, and
what is ticked under **Data** is exported. Each relation is one
`COPY (SELECT * FROM …) TO STDOUT WITH (FORMAT csv, …)`; with several, they run one after the other in a
`REPEATABLE READ READ ONLY` transaction, so all are read as of the same moment.

![The CSV options: separator, enclosure, escape, line terminator, NULL, CR/LF removal and header row](/media/tools/export-csv-options.png)

| Option | COPY option | Default |
| --- | --- | --- |
| **Columns separated with:** | `DELIMITER` (`\t` for a tab) | `,` |
| **Columns enclosed with:** | `QUOTE` | `"` |
| **Columns escaped with:** | `ESCAPE` (empty: the enclosing character) | `"` |
| **Lines terminated with:** | `AUTO` is `\n`; `\r\n` and others are put in after `COPY` | `AUTO` |
| **Replace NULL with:** | `NULL` | `NULL` |
| **Remove carriage return/line feed characters within columns** | each column read through `regexp_replace(col::text, '[\r\n]', '', 'g')` | off |
| **Put columns names in the first row** | `HEADER` | on |

**CSV for MS Excel** has **Replace NULL with:**, the CR/LF and header switches, and **Excel edition:**
(**Windows** and **Excel 2003 / Macintosh** separate with `;`, **Excel 2008 / Macintosh** with `,`).
It quotes every value (`FORCE_QUOTE *`) and ends lines with `\r\n`.

::: warning Several tables go into one CSV file
A CSV export of a schema or a database writes every table into the same file, one after the other,
each with its own header row. To get one file per table, export each table from its own Export tab.
:::

::: info CSV limits
Separator, enclosure and escape must each be one single-byte character (`;;` is refused with
*COPY takes one single-byte character to separate columns with.*), and the separator and the
enclosure must differ. The header row is never quoted, even in the Excel format. At the database level the
tables and materialized views of the ticked schemas are exported. A view has no **Data** box on the
schema level, but its own Export tab exports its rows as CSV.
:::

## Export templates

The **Export templates:** card saves the page's options under a name and loads them again, like
phpMyAdmin's.

![The Export templates card with a template selected](/media/tools/export-templates.png)

1. Set the options, type a **Template name** under **New template:** and click **Create**.
2. To load one, pick it under **Existing templates:**. The form takes its options at once; the tables
   it had ticked are ticked again only where they exist on this page.
3. **Update** overwrites the selected template with the page's current options; **Delete** removes it.

Templates are stored in phpPgAdmin's own SQLite storage, per role, per server and per level
(server, database, schema, relation), so a table template is offered on every table. Names are unique
per role and level (case does not matter) and up to 64 characters.

::: warning Delete does not ask
**Delete** removes the selected template immediately, without a confirmation.
:::

## When an export fails

The download only starts once the program has written its first bytes. A failure before that — no
connection, a permission or a lock error, a bad option — comes back as an error notification and no
file is saved: for example *pg_dump: error: query failed: ERROR: permission denied for table authors*
when you sign in as a role that cannot read every table, or *invalid client encoding* (HTTP 422).

A failure after the download has begun can only be reported in the file: a plain SQL dump ends with a
`--` comment holding the program's message, an archive is cut short, and the message goes to the web
server's error log.

::: warning A lock makes the export wait
`pg_dump` takes an `ACCESS SHARE` lock on every table it dumps and waits for it without a timeout. When
another session holds an exclusive lock (an `ALTER TABLE`, a `VACUUM FULL`, a long transaction that
altered the table), the browser shows nothing until the lock is released — in a test, a table locked
for 20 seconds delayed the download by 22 seconds. PHP's time limit is lifted for the export.
:::

::: info Large exports
The dump is streamed, so its size is limited only by the client and by proxies between you and the
web server. If you use nginx, `X-Accel-Buffering: no` is sent so that it does not buffer the dump;
other proxies may need their read timeouts raised for long dumps.
:::

## Differences from phpMyAdmin

- The SQL is PostgreSQL's own `pg_dump` output, including `\restrict` / `\unrestrict` lines
  (`pg_dump` 18 and the 2025 minor releases), not phpMyAdmin's generated SQL. Restore it with `psql`
  or phpPgAdmin's [Import](/tools/import), which handles those lines.
- There are no JSON, XML, LaTeX, PDF, ODS or Word formats; use CSV, or a query's results on the
  [SQL page](/tools/sql).
- A server export is a cluster dump: roles and tablespaces are part of it.
