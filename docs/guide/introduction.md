# Introduction

phpPgAdmin is a web application for administering PostgreSQL 13 and newer. It looks and behaves like phpMyAdmin, and covers the PostgreSQL objects and tools that pgAdmin 4 covers. This page explains what it is, what it needs, and how its pages are organised.

![The phpPgAdmin window at a table's Structure page, with its parts numbered: 1 panel header, 2 tree controls, 3 navigation tree, 4 panel collapser, 5 breadcrumb, 6 tab bar, 7 user menu, 8 page, 9 console bar](/media/guide/overview.png)

1. The navigation panel header: logo and the **Home**, **Log out** and documentation links.
2. The tree controls: **Collapse all** and **Link with main panel**.
3. The navigation tree: databases, then the objects inside each one.
4. The arrow that collapses and expands the navigation panel.
5. The breadcrumb: server, database, schema and table of the page you are on.
6. The tab bar of that level.
7. The user menu.
8. The page itself.
9. The console bar.

[Finding your way around](/guide/interface) describes each part.

## What it is

- **The phpMyAdmin interface.** The layout, the pmahomme theme, the tab names, the "With selected:" lists, the confirmation dialogs and the settings pages follow phpMyAdmin 5.2. If you know phpMyAdmin, you already know where most things are.
- **pgAdmin's coverage of PostgreSQL.** Schemas, partitions, inheritance, materialized views, procedures, domains, range and composite types, collations, full text search, extensions, foreign data wrappers, publications and subscriptions, row-level security, event triggers and more. Most create and alter forms can show the SQL they will run before they run it.
- **A plain PHP application.** PHP 8.3 with the `pgsql` extension, behind any web server. There is no agent or daemon to run, and nothing to install on the database server. You sign in with a PostgreSQL role, and every statement runs as that role, so PostgreSQL's own privileges decide what you can do.

## How it compares

| | phpMyAdmin | pgAdmin 4 | phpPgAdmin |
|---|---|---|---|
| Database | MySQL, MariaDB | PostgreSQL | PostgreSQL 13+ |
| Runs as | PHP web app | Python web app or desktop app | PHP web app |
| Sign-in | Database account | Its own user accounts, then a saved password per server | PostgreSQL role, per session |
| Interface | Tabs per level, navigation tree | Object browser with dialogs | phpMyAdmin's tabs and tree |
| Own storage | Optional configuration storage database | SQLite `pgadmin4.db` | SQLite file in `storage/` |

::: info Not the classic phpPgAdmin
This is a new application. Its configuration (`config/*.php` and `PGADMIN_*` environment variables) has nothing in common with the classic phpPgAdmin's `conf/config.inc.php`, so a classic installation cannot be upgraded in place.
:::

## The object hierarchy

PostgreSQL has one more level than MySQL: a database holds **schemas**, and tables, views, functions and types live in a schema. The interface follows that hierarchy. Each level has its own address, breadcrumb entry and tab bar:

| Level | Address | Breadcrumb | Example |
|---|---|---|---|
| Server | `/server/<tab>` | **Server:** host:port | `/server/roles` |
| Database | `/db/<database>/<tab>` | **Database:** name | `/db/bookshop/search` |
| Schema | `/db/<database>/schema/<schema>/<tab>` | **Schema:** name | `/db/bookshop/schema/public/routines` |
| Table, view, materialized view | `/db/<database>/schema/<schema>/table/<name>/<tab>` (`view/`, `mview/`) | **Table:**, **View:** or **Materialized view:** name | `/db/bookshop/schema/public/table/books/ddl` |

Every page has an address you can bookmark, reload or open in a new browser tab.

::: info One connection per database
PostgreSQL connections belong to one database, so phpPgAdmin opens a connection to each database you work in. Objects that belong to the whole cluster (roles, tablespaces, databases, replication) are on the server level. Objects inside a database (schemas, extensions, casts, event triggers, publications) are on the database level.
:::

## What you can do

**Getting started:** [Installation](/guide/installation), [Configuration](/guide/configuration), [Signing in](/guide/signing-in), [Finding your way around](/guide/interface), [Known limitations](/guide/limitations).

**Server level**

- [Databases](/server/databases): list, create and drop databases, with their sizes.
- [Status and monitoring](/server/status): server activity, sessions with cancel and terminate, locks, prepared transactions and live charts.
- [Server logs](/server/logs): read the server's log files.
- [Roles](/server/roles): create and edit roles and memberships.
- [Tablespaces](/server/tablespaces): create, edit and drop tablespaces.
- [Replication](/server/replication): replication slots, standbys, publications and subscriptions.
- [Variables](/server/variables): the server's configuration parameters.
- [Settings](/server/settings): your own phpPgAdmin preferences.

**Database level**

- [Schemas](/database/schemas): the schemas of a database.
- [Database operations](/database/operations): rename, change the owner or settings, copy, and run maintenance.
- [Search](/database/search): find text in every table of a database.
- [Extensions and other objects](/database/objects): extensions, casts, languages, event triggers and the other database-wide objects.
- [Foreign data](/database/foreign-data): foreign data wrappers, servers, user mappings and foreign tables.
- [Designer](/database/designer): an ER diagram you can edit.
- [Schema diff](/database/schema-diff): compare two schemas and get the migration script.

**Schema level**

- [Tables in a schema](/schema/structure), [Creating a table](/schema/create-table)
- [Views and materialized views](/schema/views)
- [Functions and procedures](/schema/routines)
- [Sequences](/schema/sequences)
- [Types, domains and collations](/schema/types)
- [Full text search](/schema/text-search)
- [Schema operations](/schema/operations)

**Table level**

- [Browsing data](/table/browse), [Inserting and editing rows](/table/insert), [Searching a table](/table/search)
- [Structure: columns](/table/structure), [Indexes and constraints](/table/indexes-constraints)
- [Partitions and inheritance](/table/partitions), [Triggers, rules and policies](/table/triggers)
- [Table operations](/table/operations)

**Tools**

- [SQL editor](/tools/sql), [History, bookmarks and macros](/tools/history-bookmarks), [Console](/tools/console)
- [Privileges](/tools/privileges)
- [Export](/tools/export), [Import](/tools/import), [Maintenance](/tools/maintenance)
- [Debugger](/tools/debugger) for PL/pgSQL

## Requirements

| Component | Requirement |
|---|---|
| PostgreSQL server | 13 or newer. |
| PHP | 8.3 or newer, with the `pgsql`, `pdo_sqlite`, `mbstring`, `ctype`, `zlib` and `session` extensions. `proc_open` and `exec` must not be disabled. |
| Web server | Any server that can run PHP: nginx with PHP-FPM, Apache, or PHP's built-in server for local use. phpPgAdmin must be served from the root of a host name. |
| PostgreSQL client programs | `pg_dump`, `pg_dumpall`, `pg_restore` and `psql`, for [Export](/tools/export), [Import](/tools/import) and [Maintenance](/tools/maintenance). Everything else works without them. |
| Browser | A current browser with JavaScript enabled. Without JavaScript the page stays blank. |
| Optional | The `pgstattuple` extension for more table statistics; the `pldbgapi` extension and `shared_preload_libraries = 'plugin_debugger'` for the [Debugger](/tools/debugger). |

[Installation](/guide/installation) has the details.

::: warning Older PostgreSQL versions
The SQL phpPgAdmin sends is written for PostgreSQL 13 and newer. Signing in to an older server is not refused, but pages may fail with SQL errors.
:::

## Known limitations

Some controls are drawn but their feature is not built yet. They look like working controls, as in phpMyAdmin, and answer with the notice **Not available yet.** when you use them. [Known limitations](/guide/limitations) lists them, along with other gaps.
