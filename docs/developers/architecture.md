# Architecture

This page explains how phpPgAdmin is put together: how a request travels from `public/index.php` to a controller, how modules plug into the kernel, how the database layer and the SQL templates work, where state is kept, and how the React frontend is assembled. It is a map for reading the code. [Writing a module](/developers/modules) and [SQL templates and nodes](/developers/nodes) cover the same pieces as tasks.

## The big picture

phpPgAdmin is a PHP 8.3 application with no framework. It is built from a few Composer packages: `league/route` for routing, `nyholm/psr7` for PSR-7 messages and `twig/twig` for SQL templates. PostgreSQL is reached through **ext-pgsql** (libpq), not PDO. The browser gets a single HTML shell that loads a React 19 application, and everything else is JSON under `/api`.

```text
 browser ──► public/index.php ──► App::create() ──► Kernel::boot() ──► Router::dispatch()
   ▲                                                                       │
   │                                   middleware: AddAuthHeader (global)  │
   │                                   StartSession ─ SetLocale ─ ParseJsonBody ─ Authenticate
   │                                                                       ▼
   │   JSON  ◄── ApiStrategy ◄── controller / NodeDispatcher ──► ConnectionPool ──► PostgreSQL
   │                                     │                                (ext-pgsql)
   │                                     └──► SqlTemplates (Twig) ──► SQL text
   │
   └── HTML shell (FrontendModule) + Vite assets ──► React app (src/ + Modules/*/resources/js)
```

Almost every feature lives in a **module** under `Modules/<Name>/`. The core under `app/Core/` provides the services modules build on and holds no feature code.

## Directory map

```text
app/
  App.php                  Builds the Kernel: loads config/*.php, storage, modules, translator, SQL templates
  Core/
    Kernel.php             Wires each module's capabilities into the router, then dispatches
    Contracts/             Interfaces a module implements: Module, ProvidesRoutes, ProvidesNodes, …
    Module/ModuleRegistry  Holds the modules, sorts them, answers "who provides X"
    Routing/               league/route Router subclass, PendingGroup for fluent groups
    Facades/               Static access: Route, Config, Storage, Sql, Nodes, Lang, Modules
    Http/                  ApiStrategy (JSON errors), ApiException, ResponseEmitter, ParseJsonBody
    Database/              Connector, Connection, Result, Column, ConnectionPool, Quoting, Keywords,
                           Server, Credentials, QueryException, ConnectionException
    Sql/                   SqlTemplates, VersionedLoader, TwigExtension, TemplateNamespace,
                           templates/ (shared macros and dependency queries)
    Nodes/                 NodeDefinition, NodeRegistry, NodeDispatcher, NodeContext, NodeController,
                           RelationController, Acl, Dependencies, Ddl, Catalog, Options, VacuumSettings
    Process/               BackgroundProcess (detached jobs run by bin/process-runner.php)
    Storage/               SQLite storage (PDO) and the per-module migrator
    I18n/                  Translator, Locale, LocaleResolver, TextDirection
    Frontend/Vite.php      Script and stylesheet tags from public/hot or the Vite manifest
    helpers.php            __() and trans()
artisan                    Stand-in for Laravel's artisan: only "laramod:vite"
bin/
  process-runner.php       Runs one background job (import, maintenance, debugger session)
  debugger-session.php     Holds the two pldebugger sessions of one debugging session
bootstrap/modules.php      The list of module classes, in wiring order
config/                    db.php, i18n.php, modules.php, storage.php, tools.php
Modules/<Name>/
  <Name>Module.php         The module class: which contracts it implements
  routes/api.php           API routes (and routes/web.php for the Frontend module)
  Http/Controllers/        Controllers and node controllers
  Http/Middleware/         Middleware a module ships (Auth, I18n)
  database/migrations/     SQLite migrations for the app's own storage
  resources/js/app.tsx     Frontend entry: registerModule(), pages, tabs, tree links
  resources/lang/<code>.json   Messages, read by both PHP and i18next
  resources/sql/<node>/<version>/*.sql   Twig SQL templates ported from pgAdmin
public/
  index.php                Front controller
  .htaccess                Apache rewrite to index.php
  dist/                    Built assets and manifest.json (pnpm build)
  hot                      Dev server URL, present only while pnpm dev runs
src/                       The React shell: App, layout, shared components, styles, i18n, api client
storage/                   phppgadmin.sqlite, cache/twig, processes/ (git-ignored)
tools/port-pgadmin-templates.py   Copies pgAdmin's Jinja templates into a module and converts them to Twig
docs/                      This documentation site (VitePress)
```

## Request lifecycle

### 1. Front controller

`public/index.php` builds a PSR-7 request from the globals, calls `App::create($debug)->handle($request)` and hands the response to `ResponseEmitter`. `$debug` is `true` only when the environment variable `APP_DEBUG` is `true`. When the file runs under PHP's built-in server (`php -S … public/index.php`), it returns `false` for real files so the server serves them itself.

`ResponseEmitter` writes the status line, the headers and the body. It drops a non-ASCII reason phrase (a translated exception message can end up there) and streams a non-seekable body in chunks, which is how exports reach the browser while `pg_dump` is still running.

### 2. App::create()

`app/App.php`:

1. Loads every `config/*.php` into `Config`, keyed by file name (`Config::get('db.port')`).
2. Creates the SQLite `Storage` at `storage.path` (it opens lazily, on first use).
3. Reads the module classes from `bootstrap/modules.php` into a `ModuleRegistry`.
4. Builds the `Translator` from `config/i18n.php` and the `SqlTemplates` with its Twig cache at `<directory of storage.path>/cache/twig`.
5. Creates the `Kernel` with the route groups from `config/modules.php` and boots it.

### 3. Kernel::boot()

`Kernel::boot()` asks the registry which modules implement each contract, in this order:

| Step | Contract | What happens |
|---|---|---|
| `bootTranslations` | `ProvidesTranslations` | The module's `resources/lang` becomes a namespace named after the module |
| `bootSqlTemplates` | `ProvidesSqlTemplates` | The module's `resources/sql` is added as a template root, after the core root |
| `bootNodes` | `ProvidesNodes` | The module's `NodeDefinition`s are registered |
| `bootMigrations` | `ProvidesMigrations` | The module's migration directory is handed to the migrator |
| `bootGlobalMiddlewares` | `ProvidesGlobalMiddlewares` | Middleware added to the router itself, so they run for every matched route |
| `bootRoutes` | `ProvidesRoutes`, `ProvidesApiRoutes` | Each module's routes are registered inside the `web` or `api` group; then the node routes are generated inside the `nodes` group |

The kernel boots on every request. There is no route cache: about 700 routes are registered each time (around 15 ms for `App::create()` on the CLI without opcache).

### 4. Route groups and middleware

`config/modules.php` defines three groups. Each is a prefix plus a list of PSR-15 middleware classes:

| Group | Wraps | Prefix | Middleware |
|---|---|---|---|
| `web` | `ProvidesRoutes::routes()` | none | `StartSession`, `SetLocale` |
| `api` | `ProvidesApiRoutes::apiRoutes()` | `api` | `StartSession`, `SetLocale`, `ParseJsonBody` |
| `nodes` | the generated node routes | `api` | `StartSession`, `SetLocale`, `ParseJsonBody`, `Authenticate` |

| Middleware | Lives in | What it does |
|---|---|---|
| `StartSession` | `Modules/Auth/Http/Middleware` | `session_start()` (skipped on the CLI) |
| `SetLocale` | `Modules/I18n/Http/Middleware` | Picks the locale from `?lang=`, the session, the `pga_lang` cookie, `Accept-Language`, then the default; sets `Content-Language` and refreshes the cookie |
| `ParseJsonBody` | `app/Core/Http/Middleware` | Decodes an `application/json` body into `getParsedBody()`; malformed JSON is a 400 |
| `Authenticate` | `Modules/Auth/Http/Middleware` | Rejects a session without a user, credentials and server (401); otherwise attaches the `user` attribute and a `ConnectionPool`, and closes the pool's connections when the handler returns |

The `api` group does not authenticate by itself. Each module wraps the routes that need a signed-in role in `Route::middleware(Authenticate::class)->group(…)`. The login, server list and locale routes are left outside it on purpose.

::: info AddAuthHeader
The Auth module also registers `AddAuthHeader` as a global middleware. It is a leftover example of `ProvidesGlobalMiddlewares` and adds `X-Auth-Module: enabled` to every response. It has no other effect.
:::

::: warning The session stays locked for the whole request
PHP's file sessions are locked from `session_start()` until the script ends, and `StartSession` never closes the session early. Two requests from the same browser therefore run one after the other. The long-running controllers (query, export, import, maintenance, debugger) call `session_write_close()` themselves before the slow part. Do the same in any new endpoint that can take more than a moment.
:::

### 5. Controllers and the JSON strategy

The router uses `ApiStrategy`, league/route's `JsonStrategy` with its own error handling. A controller action receives `(ServerRequestInterface $request, array $args)` and returns either an array, which is encoded as JSON, or a `ResponseInterface`. Controllers are created with `new`, without a container, so their constructors take no arguments.

Errors become JSON bodies that always have `status_code` and `reason_phrase`:

| Thrown | Status | Body |
|---|---|---|
| league/route HTTP exceptions (`BadRequestException`, `NotFoundException`, `GoneException`, …) | the exception's | the message is in `reason_phrase` |
| `QueryException` (a PostgreSQL error) | by SQLSTATE: `42501` → 403; classes `42`, `22`, `0A` → 400; `23`, `55`, `40`, `2B` → 409; `57` → 503; anything else → 500 | `message`, plus `sqlstate`, `detail`, `hint`, `position` when the server sent them |
| `ApiException($status, $message, $fields)` | as given | `message` plus your own fields (the frontend reads a `remedy` field, for example) |
| `ConnectionException` | 401 when the server turned the role or password down; 503 for anything else (unreachable server, missing database, no CONNECT privilege) | `message` (libpq's text) |
| anything else | 500 | only `status_code` and `reason_phrase`, unless `APP_DEBUG=true`, which adds `exception`, `message` and `trace` |

The frontend's `ApiError` reads `message` first and falls back to `reason_phrase`, so either way of reporting a message reaches the user.

### 6. The HTML shell

The Frontend module has one web route, `GET /{path}` for every path not starting with `api`. It is wired last (`order(): -1`) so its catch-all never shadows another route. `ShellController::show()` writes a small HTML page with:

- `<html lang dir>` set from the locale `SetLocale` picked;
- `<script id="app-config">` with that locale and the list of locales;
- the script tags of every module's `frontendScripts()`, in module order, followed by `src/main.tsx`.

`app/Core/Frontend/Vite.php` writes those tags. When `public/hot` exists it points them at the Vite dev server; otherwise it reads `public/dist/manifest.json` and adds the CSS, the entry chunks and `modulepreload` links. Without either, every page is a JSON 500; with `APP_DEBUG=true` its message says "Vite manifest not found … Run "pnpm build" or "pnpm dev"."

## Module system

The module system follows [laramod](https://github.com/protibimbok/laramod): a module is a class implementing `PhpPgAdmin\Core\Contracts\Module` (`name()`, `path()`), plus any of the capability contracts in `app/Core/Contracts`:

| Contract | Method | Provides |
|---|---|---|
| `ProvidesRoutes` | `routes(): void` | Web routes, in the `web` group |
| `ProvidesApiRoutes` | `apiRoutes(): void` | API routes, in the `api` group (prefix `/api`) |
| `ProvidesGlobalMiddlewares` | `globalMiddlewares(): array` | Middleware for every matched route |
| `ProvidesNodes` | `nodes(): array` | `NodeDefinition`s; the node routes are generated from them |
| `ProvidesSqlTemplates` | `sqlTemplatesPath(): string` | A template root, usually `resources/sql` |
| `ProvidesTranslations` | `translationsPath(): string` | A message directory, usually `resources/lang` |
| `ProvidesMigrations` | `migrationsPath(): string` | SQLite migrations, usually `database/migrations` |
| `ProvidesViteEntries` | `viteEntries(): array` | Files Vite builds for the module |
| `ProvidesFrontendScripts` | `frontendScripts(): array` | Entries the shell loads before `src/main.tsx`; each must also be in `viteEntries()` |
| `Ordered` | `order(): int` | Wiring position; lower first, negative last |

Modules are not discovered from the file system. `bootstrap/modules.php` lists them and its order is the wiring order, unless a module implements `Ordered`. The same list feeds `php artisan laramod:vite`, which tells the Vite plugin which entries to build. See [Writing a module](/developers/modules).

The current modules and what they provide (from `ModuleRegistry::capabilities()`):

| Module | Capabilities | Node types |
|---|---|---|
| `i18n` | api, translations | |
| `auth` | api, global-middlewares, translations, migrations | |
| `server` | api, vite, frontend-scripts, translations | |
| `databases` | api, vite, frontend-scripts, translations, sql, nodes | 1 |
| `roles` | api, vite, frontend-scripts, translations, sql, nodes | 2 (role, tablespace) |
| `status` | api, vite, frontend-scripts, translations, sql | |
| `schemas` | api, vite, frontend-scripts, translations, sql, nodes | 1 |
| `tables` | api, vite, frontend-scripts, translations, sql, nodes | 13 |
| `views` | api, vite, frontend-scripts, translations, sql, nodes | 4 |
| `sequences` | api, vite, frontend-scripts, translations, sql, nodes | 1 |
| `routines` | api, vite, frontend-scripts, translations, sql, nodes | 5 |
| `types` | api, vite, frontend-scripts, translations, sql, nodes | 7 |
| `dbobjects` | api, vite, frontend-scripts, translations, sql, nodes | 8 |
| `replication` | api, vite, frontend-scripts, translations, sql, nodes | 2 |
| `export`, `import` | api, vite, frontend-scripts, translations, migrations | |
| `maintenance` | api, translations | |
| `search` | api, vite, frontend-scripts, translations, sql | |
| `settings` | vite, frontend-scripts, translations | |
| `schemadiff`, `debugger` | api, vite, frontend-scripts, translations | |
| `designer`, `sql` | api, vite, frontend-scripts, translations, migrations | |
| `frontend` | routes | |

::: info One dependency from core to a module
`app/Core/Nodes/RelationController.php` imports `DatabaseController::LAST_SYSTEM_OID` from the Databases module. The core is otherwise independent of the modules, so removing the Databases module would break every relation node.
:::

## Database layer

Everything under `app/Core/Database/` uses ext-pgsql. PDO is used only for the SQLite storage. ext-pgsql was chosen because the query tool and the node framework need what PDO_pgsql does not expose: server notices (`VACUUM VERBOSE` output), the source table and type OID of each result column, one result per statement in a batch, the error fields (SQLSTATE, detail, hint, position) and connection-aware quoting.

| Class | Role |
|---|---|
| `Server` | Readonly: id, name, host, port, sslmode, maintenance database. Loaded from the `servers` table or from `config/db.php`. A host starting with `/` is a Unix socket directory, and no `sslmode` is sent for it. |
| `Credentials` | Username, password and the database the login landed in. Kept in the PHP session. |
| `Connector` | Opens connections with `pg_connect(conninfo, PGSQL_CONNECT_FORCE_NEW)`. `login()` tries the server's maintenance database, then `postgres`, `template1` and the role's own database, and moves on only when the database is missing or refuses the role. Sets `application_name=phpPgAdmin` and `connect_timeout` from `db.timeout`. `environment()` gives the `PG*` variables (password in `PGPASSWORD`) for `pg_dump`, `psql` and the background runner. |
| `Connection` | One libpq connection. `query($sql, $params)` (uses `pg_send_query_params` when there are params, `$1`…), `rows()`, `row()`, `scalar()`, `exec()` (affected rows), `queryMulti($sql)` (one `Result` per statement), `transaction(callable)`, `version()` (cached `server_version_num`), `backendPid()`, `escapeIdentifier()`, `escapeLiteral()`, `cancel()`, `close()`. |
| `Result`, `Column` | `columns()` with name, type OID and name, table OID and attnum; `rows()`, `rowsAsLists()`, `textRows()`, `row()`, `scalar()`, `affectedRows()`, `commandTag()`, `notices()`. |
| `ConnectionPool` | One per request, created by `Authenticate`. `ConnectionPool::from($request)->for($db)` opens a connection to that database on first use and hands out the same one after that. `maintenance()` is the database the login landed in. All connections are closed when the request ends. |
| `QueryException` | A PostgreSQL error with its fields and `httpStatus()`. |
| `Quoting`, `Keywords` | A port of pgAdmin's `qtIdent` / `qtTypeIdent` / `qtLiteral` and its keyword list. |

### Statements and transactions

Every statement runs in autocommit mode unless you wrap it in `$conn->transaction(fn () => …)`. A batch sent through `queryMulti()` runs as one implicit transaction. It stops at the first error, which is thrown, and the results of the statements before it are lost.

There are no transactions spanning requests. Each request opens its own connections, and they are closed at the end of the request, so session state such as `SET`, temporary tables or an open `BEGIN` does not carry over to the next request. The SQL editor's "run as one transaction" option works because the whole batch is sent in one request.

### Quoting

`Quoting::ident('public', 'Books')` gives `public."Books"`. An identifier is quoted when it starts with a digit, contains anything other than `a-z`, `0-9` or `_`, or is a reserved, type-function or column-name keyword. `typeIdent()` also leaves type names such as `character varying` and column-name keywords unquoted. Empty or null parts are skipped. `Quoting::literal()` gives `NULL`, `true`/`false`, bare numbers, `'…'` with doubled quotes (`E'…'` when there is a backslash) and `ARRAY[…]` for lists.

```php
Quoting::ident('public', 'books');   // public.books
Quoting::ident('user');              // "user"
Quoting::typeIdent('between');       // between
Quoting::literal("it's");            // 'it''s'
Quoting::literal('a\b');             // E'a\\b'
```

Prefer bound parameters (`$conn->rows('… WHERE oid = $1', [$oid])`) for values. Use `Quoting` for identifiers and in the places where pgAdmin's templates build literals.

## SQL templates

Catalog queries and DDL are Twig templates ported from pgAdmin's Jinja templates, with pgAdmin's file names (`properties.sql`, `create.sql`, `nodes.sql`…). They live in `Modules/<Name>/resources/sql/<node>/<version>/`. The version folders are `default`, `11_plus` up to `18_plus`. Today the modules use `default`, `12_plus`, `14_plus`, `15_plus`, `16_plus` and `17_plus`.

```php
Sql::render('sequences', 'create.sql', ['data' => $data, 'conn' => $conn], $conn->version());
```

`VersionedLoader` walks the version folders from newest to oldest, skips those newer than the server and returns the first file that exists. Each file is resolved on its own, so a version folder only needs the files that changed. The core root `app/Core/Sql/templates/` holds the shared macros (`macros/privilege.macros`, `macros/schemas/security.macros`…) and the dependency queries, under the names pgAdmin's templates import them by. Details, the Twig helpers and the override rules are in [SQL templates and nodes](/developers/nodes#sql-templates).

## Node framework

pgAdmin's object model is called "nodes": database, schema, table, column, index and so on. A module declares node types with `NodeDefinition` (type, collection, OID route parameter, controller, parent type, template folder, supported operations). `NodeRegistry` generates a REST API for each type under its parent's path:

```text
GET    /api/databases/{db}/schemas/{scid}/sequences            list
GET    /api/databases/{db}/schemas/{scid}/sequences/nodes      tree children
POST   /api/databases/{db}/schemas/{scid}/sequences            create
GET    /api/databases/{db}/schemas/{scid}/sequences/{seid}     properties
PUT    /api/databases/{db}/schemas/{scid}/sequences/{seid}     update
DELETE /api/databases/{db}/schemas/{scid}/sequences/{seid}     delete (?cascade=1)
…/msql, …/{seid}/sql, …/stats, …/{seid}/dependencies, …/{seid}/dependents, …/{seid}/children
GET    /api/databases/{db}/resolve?type=sequence&schema=public&name=invoice_number
```

`NodeDispatcher` builds a `NodeContext` (connection, OIDs from the route, server version) and calls the matching method of the type's `NodeController` subclass. The frontend keeps name-based URLs and calls `resolve` to get the OIDs. 44 node types are registered. The full story is in [SQL templates and nodes](/developers/nodes).

## Background processes

Work that outlasts a request (an import with `psql` or `pg_restore`, a maintenance run, a debugger session) goes through `app/Core/Process/BackgroundProcess.php` and `bin/process-runner.php`. This is a port of pgAdmin's `process_executor.py`.

1. `BackgroundProcess::prepare()` creates `storage/processes/<24 hex digits>/` (mode 0700; the location is the `storage.processes` setting).
2. `start($program, $arguments, $environment, $input)` writes `job.json` (program, arguments, input file; never the environment, which holds the password), then starts `php bin/process-runner.php <dir>` through `/bin/sh -c '… &'` and waits up to two seconds for `status.json` to appear.
3. The runner calls `setsid`, runs the program with the given environment, feeds the input file to its stdin (inflating gzip on the fly), appends everything the program prints to `output.log`, and rewrites `status.json` atomically: PIDs, start and end time, exit code, bytes read, error lines counted.
4. `status()` reads `status.json` and reports `running`, `finished`, `failed`, `killed`, or `lost` (the runner is gone without having written an end). `output($offset)` returns new log text in whole lines, up to 256 KiB at a time. `stop()` sends SIGTERM to the runner, which sends SIGINT to the program first (psql and pg_restore cancel the statement on the server) and then SIGTERM.
5. `remove()` deletes the directory.

The Import module adds a row to the SQLite `processes` table for each job, so the jobs can be listed per role (`GET /api/processes`). `bin/debugger-session.php` is a long-running program started the same way: it holds the target and proxy sessions pldebugger needs and takes commands on a Unix socket. Export does not use background processes. It streams `pg_dump` output straight into the response through `proc_open`.

::: warning POSIX only
The runner is started through `/bin/sh` and relies on `setsid`, signals and `/proc` or `posix_kill`. Install ext-posix and ext-pcntl for clean stopping. Background jobs do not work on Windows hosts. `tools.php_binary` (`PGADMIN_PHP_BINARY`) chooses the PHP CLI that runs them. Without it, the CLI next to the running PHP (`PHP_BINDIR/php`) is used, which is not always the right binary under PHP-FPM.
:::

## Storage

The application's own state is a SQLite database at `storage/phppgadmin.sqlite`, or at `PGADMIN_STORAGE_PATH`. `Storage::connection()` opens it with PDO, turns on WAL, `busy_timeout = 5000` and foreign keys, and runs pending migrations on first use. Each module owns its tables through `ProvidesMigrations`. Migrations run once each, sorted by file name across all modules, and are recorded in `migrations` as `<module>/<file>`.

Rows belonging to a role are keyed by `server` (`host:port` of the PostgreSQL server) and `username`.

| Table | Module | Holds |
|---|---|---|
| `servers` | Auth | Saved servers: name, host, port, sslmode, maintenance database, last username, last used. `UNIQUE(host, port)`. A successful login adds or updates its server. |
| `preferences` | Auth | Per-role settings, one JSON value per key; the [preferences registry](/developers/frontend#preferences) reads and writes them through `GET/PATCH /api/preferences`. Also holds the role's chosen locale. |
| `query_history` | Sql | Every statement run from the SQL editor and console: database, SQL, status, affected rows, duration, message. |
| `running_queries` | Sql | Request id → backend PID while a query runs, so `POST /api/query/cancel` can call `pg_cancel_backend()`. |
| `bookmarks` | Sql | Saved queries, private or shared, per database. |
| `macros` | Sql | Named SQL snippets with an optional key. |
| `processes` | Import | Background jobs: id (the process directory), database, schema, relation, type, description, redacted command, start and end, exit code. |
| `export_templates` | Export | Saved export option sets per export type. |
| `designer_pages` | Designer | Saved Designer layouts per database. |
| `migrations` | core | Which migrations have run. |

The Twig cache (`storage/cache/twig`) and the process directories (`storage/processes`) sit next to the database. Passwords are never written to storage. They live only in the PHP session.

## Frontend shell

The React application is split the same way as the backend:

- `src/` is the shell: `main.tsx` (entry), `App.tsx` (session check, login, layout), `modular.ts` (module registry), `layout/` (navigation panel, breadcrumb and tab bar, notifications), `components/` (Modal, PreviewSql, ConfirmQuery, SqlView, DependencyPanel, StatisticsPanel, ObjectSection, Icon), `api/` (fetch wrapper and `useRequest`), `nodes/` (node API client and link registry), `preferences.ts`, `i18n/`, `styles/` and `img/`.
- Each module's `resources/js/app.tsx` calls `registerModule({ id, order, menuFilter, routes, fills })` at its top level. The shell loads those scripts before `src/main.tsx`, which calls `seal()` and renders. A registration that arrives later throws an error.

This follows protibimbok/laramod-admin: modules add pages (React Router route objects), tabs (a `menuFilter` that edits the tab list) and fills (content placed in a slot the layout owns, such as the navigation tree). See [Frontend](/developers/frontend).
