# Known limitations

This page collects what phpPgAdmin does not do yet, and the behaviour that most often surprises people coming from phpMyAdmin or pgAdmin. Each item links to the page that covers it in detail. Where the UI has no form for something, the [SQL editor](/tools/sql) can always run the statement directly.

## Not built yet

Controls for unbuilt features still appear, as they do in phpMyAdmin. Clicking one shows **Not available yet.** instead of doing anything; see [Controls that are not built yet](/guide/interface#controls-that-are-not-built-yet).

### Server and databases

- The create-database card has no locale, tablespace or connection-limit fields, and no **Preview SQL** ([Databases](/server/databases#create-a-database)).
- Per-database `SET` parameters (`ALTER DATABASE … SET`) are shown in **Show create** but cannot be edited ([Database operations](/database/operations#database-properties)).
- Prepared transactions are listed only when `max_prepared_transactions` is above 0, which needs a server restart ([Status](/server/status#prepared-transactions)).
- Saved servers cannot be renamed or removed from the UI ([Signing in](/guide/signing-in#renaming-and-removing-saved-servers)).

### Tables

These options are not in the forms; use the SQL tab for them:

- **Create table:** `UNLOGGED`, `GENERATED ALWAYS` identity, generated stored columns, compression, storage, `WITH (…)` parameters and `LIKE` ([Creating a table](/schema/create-table)).
- **Changing columns:** a `USING` clause for type changes ([Structure](/table/structure#changing-columns)).
- **Indexes:** expressions, operator classes, `INCLUDE`, `NULLS FIRST/LAST` and `CONCURRENTLY` ([Indexes and constraints](/table/indexes-constraints#indexes)).
- **Constraints:** `NOT VALID` / `VALIDATE CONSTRAINT`, and foreign key `MATCH` and `DEFERRABLE` ([Indexes and constraints](/table/indexes-constraints)).
- **Partitions:** `DETACH PARTITION … CONCURRENTLY` ([Partitions](/table/partitions)).
- **Row level security:** the `ENABLE` / `FORCE ROW LEVEL SECURITY` switch ([Triggers, rules and policies](/table/triggers#row-security-policies)).
- **Table operations:** storage parameters ([Table operations](/table/operations)).

### Other objects

- **Views:** the create form has no `security_invoker`, `RECURSIVE` or storage options. There is no **Create view** link in the tree or on the schema page; views are created from query results or the create-view address ([Views](/schema/views#create-a-view)).
- **Routines:** there are no fields for `WINDOW`, `SUPPORT` or a C function's object file. Aggregates and operators are read-only: you can view their DDL and drop them ([Functions and procedures](/schema/routines)).
- **Sequences:** there are no data type or `RESTART` fields ([Sequences](/schema/sequences)).
- **Collations:** there is no **Refresh version** button ([Types](/schema/types#collations)).
- **Schemas:** the create-schema card has no comment field, and there is no copy-schema card ([Schemas](/database/schemas), [Schema operations](/schema/operations)).
- **Foreign data:** there is no `IMPORT FOREIGN SCHEMA`. Privileges cannot be edited on languages, foreign data wrappers or foreign servers. Foreign tables are not listed on the schema's table list ([Foreign data](/database/foreign-data)).
- **Privileges:** sequences and routines have no **Privileges** tab; use the grant wizard ([Privileges](/tools/privileges#grant-wizard)).

### Export, import and tools

- **Export:** the `pg_dump` directory format is not offered. A schema or database CSV export puts every table in one file ([Export](/tools/export)).
- **Import:** restricted mode rejects backslash commands, so a `pg_dumpall` file (which uses `\connect`) cannot be imported. CSV import is only available for a single table; there is no new-table-from-CSV at database or schema level. ODS, XML and other phpMyAdmin formats are not offered ([Import](/tools/import#restricted-mode)).
- **Debugger:** only direct debugging, on a call you start, is available. There is no in-context debugging, no global breakpoints, and trigger functions cannot be debugged ([Debugger](/tools/debugger#what-is-not-built)).
- **Designer:** **Reload** does not add tables created after the layout was saved ([Designer](/database/designer)).
- **Schema diff:** both schemas must be on the server you are signed in to. Database-level objects, roles, tablespaces and data are not compared ([Schema diff](/database/schema-diff#what-is-compared)).

### SQL editor and results

- Results cannot be exported straight from the grid, and there is no **Display chart** ([SQL editor](/tools/sql#results)).
- The error position is not marked in the editor ([SQL editor](/tools/sql#errors)).

## Behaviour to know about

### Each run is a new session

Every run of the SQL editor uses a fresh connection, so `SET`, temporary tables and an open `BEGIN` do not carry over to the next run. Use **Run as one transaction** when several statements must share a transaction. A schema's SQL tab does not set `search_path` ([Where the statements run](/tools/sql#where-the-statements-run)).

### Paging re-runs the query

A paged `SELECT` is wrapped in a subquery and run again for every page and for the row count, so volatile functions such as `nextval()` run more than once. Statements that cannot be wrapped, and every statement in a batch after the first, return all their rows with no limit ([How paging and ordering work](/tools/sql#how-paging-and-ordering-work)).

### PostgreSQL is not MySQL

- New columns always go at the end of the table; PostgreSQL cannot place them ([Adding columns](/table/structure#adding-columns)).
- Enum labels cannot be removed, and new labels go at the end ([Enum types](/schema/types#enum-types)).
- Changing a function's return type needs a drop and re-create. Changing an argument type creates a second function (an overload) instead of changing the existing one ([Edit a routine](/schema/routines#edit-a-routine)).
- `CREATE INDEX CONCURRENTLY`, `VACUUM`, `ALTER SYSTEM` and the subscription statements cannot run inside a transaction.
- Some edits drop and re-create the object: views, materialized views (which loses their indexes), domains when the base type changes, languages, event triggers and servers when certain fields change. Each page says which fields do this.
- `DROP … CASCADE` on a type or extension also drops the table columns that use it, with their data.

### Privileges and requirements

- Logs need the `pg_monitor` and `pg_read_server_files` roles ([Server logs](/server/logs#requirements)).
- Non-superusers see only their own sessions on the Status tab ([Status](/server/status)).
- Event triggers, text search parsers and templates, and untrusted languages need a superuser.
- Export, import and maintenance run the PostgreSQL client programs on the web server, which must be at least as new as the server ([Configuration](/guide/configuration)).
- The debugger needs the `pldbgapi` extension and `plugin_debugger` in `shared_preload_libraries` ([Debugger](/tools/debugger)).
- phpPgAdmin must be served from the root of a host name, not a sub-path ([Installation](/guide/installation#web-server)).

### Sessions

- When the PHP session expires, pages show **Unauthorized** until you reload; you are not sent to the login page ([Signing in](/guide/signing-in#when-the-session-expires)).
- `localhost` and `127.0.0.1` are separate saved servers, each with its own settings and history ([Saved servers](/guide/signing-in#saved-servers)).
