# Compared with the classic phpPgAdmin

This application shares its name with the classic [phpPgAdmin](https://github.com/phppgadmin/phppgadmin), the PHP administration tool for PostgreSQL first released in 2002. It is a separate application, written from scratch, and shares no code or configuration with it. This page compares the two so you can choose between them, and lists what to expect if you move from one to the other.

## At a glance

| | Classic phpPgAdmin | This phpPgAdmin |
|---|---|---|
| Latest release | 7.13.0, November 2020 | See [Releases](https://github.com/protibimbok/phpPgAdmin/releases) |
| PostgreSQL | 7.4 to 13, provisional 14 | 13 and newer |
| PHP | 7.1 and newer; 7.13.0 was announced as the last release for PHP 7.2 | 8.3 and newer |
| License | GPL 2.0 or later | MIT |
| Interface | Its own, with a frame-style object browser on the left | phpMyAdmin 5.2's layout, pmahomme theme and tabs |
| Pages | Rendered on the server; most work without JavaScript | A single-page application; JavaScript is required |
| Configuration | `conf/config.inc.php` | `config/*.php` and `PGADMIN_*` environment variables ([Configuration](/guide/configuration)) |
| Servers | Listed in `conf/config.inc.php` | Any host entered at sign-in, remembered as a [saved server](/guide/signing-in#saved-servers) |
| Own storage | None; history is kept in the PHP session | SQLite file in `storage/` for saved servers, settings, history and bookmarks |
| Translations | 30+ languages | English and Arabic ([Translations](/developers/translations)) |
| Extending it | Plugins (`Report`, `GuiControl`) | [Modules](/developers/modules) |

Both sign in with a PostgreSQL role and run every statement as that role, so PostgreSQL's privileges decide what you can do in either one.

## PostgreSQL features

The classic phpPgAdmin's last release supports PostgreSQL up to 13, but most of its forms date from earlier versions. Objects added to PostgreSQL in the last decade are not in its interface; you reach them through its SQL page.

| Feature | Classic | This one |
|---|---|---|
| Tables, columns, indexes, constraints, triggers, rules | Yes | Yes |
| Table info: inheritance, referencing foreign keys | Yes | [Yes](/table/structure#referenced-by-and-inheritance) |
| Per-table autovacuum settings, CLUSTER on an index | Yes | [Yes](/table/operations) |
| Views | Yes | Yes |
| Materialized views | No | [Yes](/schema/views) |
| Declarative partitioning | No | [Yes](/table/partitions) |
| Identity columns | No | [Yes](/table/structure) |
| Functions | Yes | [Yes](/schema/routines) |
| Procedures | No | [Yes](/schema/routines) |
| Aggregates | Create, drop | [Create, edit, drop](/schema/routines#aggregates-and-operators) |
| Operators | Create, drop | [Create, edit, drop](/schema/routines#aggregates-and-operators) |
| Operator classes and families, conversions | List | [List, DDL, drop](/schema/types#operator-classes-families-and-conversions) |
| Sequences, domains, enum and composite types | Yes | [Yes](/schema/types), with sequence [Restart and Next value](/schema/sequences#restart-and-next-value) |
| Range types, collations | No | [Yes](/schema/types) |
| Full text search configurations and dictionaries | Yes | [Yes, with parsers and templates](/schema/text-search) |
| Extensions | No | [Yes](/database/objects) |
| Casts, languages | List | [Create, edit, drop](/database/objects) |
| Event triggers | No | [Yes](/database/objects) |
| Foreign data wrappers, servers, user mappings, foreign tables | No | [Yes](/database/foreign-data) |
| Row-level security policies | No | [Yes](/table/triggers#row-security-policies) |
| Publications and subscriptions, replication slots, standbys | No | [Yes](/server/replication) |
| Roles, tablespaces | Yes | [Yes](/server/roles) |
| Changing your own password | Account page | [Change password](/guide/signing-in#changing-your-password) on the home page |
| Per-database settings (`ALTER DATABASE … SET`) | Variables page (read) | [Parameters](/database/operations#parameters) (read and edit) |
| Default privileges, column privileges, grant wizard | No | [Yes](/tools/privileges) |
| SQL preview before create and alter | No | Yes, on most forms |

## Tools

| Tool | Classic | This one |
|---|---|---|
| SQL editor | Text area with a query history, Explain and Explain Analyze | [Editor](/tools/sql) with autocomplete, formatting, bind parameters, history, bookmarks and macros; Explain and Explain analyze |
| Browsing data | Paged table with edit and delete links | [Grid](/table/browse) with sorting, filters and inline editing |
| Search | Find objects by name | [Find objects by name, or text in every table](/database/search) of a database |
| Server activity | Processes with cancel and kill, and locks, refreshed every few seconds, per server and per database | [Status](/server/status): live charts, sessions with cancel and terminate, locks, prepared transactions; a database's [Processes tab](/server/status#database-processes) |
| Server logs | No | [Yes](/server/logs) |
| Configuration parameters | No | [Variables](/server/variables) |
| Export | `pg_dump` / `pg_dumpall` as SQL; table data as SQL, `COPY`, CSV, tab-separated, HTML or XML | [`pg_dump` / `pg_dumpall`](/tools/export) as SQL, custom or tar archives; table, view and query rows as SQL (`INSERT` or `COPY`), CSV, tab-separated, HTML or XML |
| Import | Table data from CSV, tab-separated or XML | [SQL scripts, `pg_restore` archives](/tools/import) run in the background; CSV, tab-separated, `COPY` binary and XML into a table |
| Maintenance | `VACUUM`, `ANALYZE`, `REINDEX`, `CLUSTER` | [The same](/tools/maintenance), run through the client programs |
| ER diagram | No | [Designer](/database/designer) |
| Schema comparison | No | [Schema diff](/database/schema-diff) with a migration script |
| PL/pgSQL debugger | No | [Yes](/tools/debugger) |
| Saved reports | `Report` plugin | [Bookmarks](/tools/history-bookmarks) |

## When the classic phpPgAdmin fits better

- **PostgreSQL older than 13.** This application's SQL is written for 13 and newer; the classic one has query variants back to 7.4.
- **PHP older than 8.3.** The classic phpPgAdmin targets PHP 7.
- **No JavaScript.** The classic pages are plain HTML forms.
- **A language other than English or Arabic.**

The classic release predates PostgreSQL 15 and PHP 8.3, so try it with your own versions before relying on it.

## Moving from the classic phpPgAdmin

- Install this application next to the classic one, not over it. Nothing in `conf/config.inc.php` is read; see [Installation](/guide/installation) and [Configuration](/guide/configuration).
- Servers are not configured in a file. Enter the host on the login page once and it becomes a [saved server](/guide/signing-in#saved-servers); `config/db.php` sets the [default server](/guide/configuration#default-server).
- The classic `extra_login_security` setting is `PGADMIN_EXTRA_LOGIN_SECURITY=1` ([Configuration](/guide/configuration#login-security)): it refuses `postgres`, `pgsql`, `root`, `administrator` and empty passwords.
- The classic `owned_only` setting is `PGADMIN_OWNED_ONLY=1`: a role that is not a superuser sees only the databases it owns. It only hides names; PostgreSQL's privileges still decide what a role can open.
- The classic `show_system` setting is the **Show system objects** preference under Settings » Navigation panel, per role.
- Server groups are not needed: every server signed in to is a [saved server](/guide/signing-in#saved-servers) offered at sign-in.
- Only the pmahomme theme is offered; the classic app's themes do not carry over.
- The layout follows phpMyAdmin: server, database, schema and table each have a tab bar, and each page has its own address. [Finding your way around](/guide/interface) describes it.
- Some forms are not complete yet. [Known limitations](/guide/limitations) lists what to do in the SQL editor instead.
