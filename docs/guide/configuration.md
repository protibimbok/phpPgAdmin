# Configuration

phpPgAdmin is configured with PHP files in `config/` and environment variables that override them. This page lists every setting. Per-user preferences, such as rows per page, are not here: each role sets those on the server's [Settings](/server/settings) tab.

## How configuration is read

Each `config/<name>.php` returns an array, read as `<name>.<key>`, so `config/db.php`'s `host` is `db.host`. Most values have the form `getenv('PGADMIN_…') ?: default`, so you can:

- **set environment variables in the web server** (recommended, because upgrades replace `config/`), or
- **edit the defaults in `config/*.php`.**

An empty environment variable counts as not set.

::: warning There is no .env file
phpPgAdmin does not read a `.env` file. The variables must be in the environment of the PHP process that serves the pages:

- **nginx + PHP-FPM:** `fastcgi_param PGADMIN_DB_HOST db.internal;` in the PHP location, or `env[PGADMIN_DB_HOST] = db.internal` in the FPM pool file. PHP-FPM's default `clear_env = yes` drops the environment the FPM service was started with, so `export` in a shell or a systemd `Environment=` only works with `clear_env = no`.
- **Apache:** `SetEnv PGADMIN_DB_HOST db.internal` (needs `mod_env`). This works with mod_php and with PHP-FPM through `proxy_fcgi`.
- **PHP's built-in server:** `PGADMIN_DB_HOST=db.internal php -S localhost:8080 -t public public/index.php`.
:::

The server home page's **Database server** card shows which server you are on; the login page's **Advanced** section shows the default server from this configuration.

## Environment variables

| Variable | Config key | Default | What it does |
|---|---|---|---|
| `PGADMIN_DB_HOST` | `db.host` | `localhost` | The default server's host: a host name, an IP address, or the directory of a Unix socket (`/var/run/postgresql`). |
| `PGADMIN_DB_PORT` | `db.port` | `5432` | The default server's port. |
| `PGADMIN_DB_SSLMODE` | `db.sslmode` | `prefer` | libpq's SSL mode: `disable`, `allow`, `prefer`, `require`, `verify-ca` or `verify-full`. Ignored for a Unix socket. |
| `PGADMIN_DB_DATABASE` | `db.database` | none | The maintenance database: where a login connects first. Unset, it tries `postgres`, then `template1`, then the database named after the role. |
| `PGADMIN_DB_TIMEOUT` | `db.timeout` | `10` | Seconds to wait for a server before the connection fails (libpq's `connect_timeout`). Also passed to the client programs as `PGCONNECT_TIMEOUT`. |
| `PGADMIN_STORAGE_PATH` | `storage.path` | `storage/phppgadmin.sqlite` | The SQLite file phpPgAdmin keeps its own data in. The compiled template cache goes in a `cache/` directory next to it. |
| `PGADMIN_PROCESS_DIR` | `storage.processes` | `storage/processes` | Where imports, maintenance runs and debugger sessions keep their working files. |
| `PGADMIN_UPLOAD_DIR` | `storage.upload_dir` | none | A directory on the web server whose files the Import pages offer as well as an upload. |
| `PGADMIN_PG_BIN_DIR` | `tools.bin_dir` | none (searched) | The directory holding `pg_dump`, `pg_dumpall`, `pg_restore` and `psql`. |
| `PGADMIN_PHP_BINARY` | `tools.php_binary` | none | The PHP command-line binary that runs the background scripts in `bin/`. |
| `PGADMIN_DEBUGGER` | `tools.debugger` | on | Set to `0` to switch the PL/pgSQL debugger off. |
| `PGADMIN_EXTRA_LOGIN_SECURITY` | `auth.extra_login_security` | off | Set to `1` to refuse the usual superuser names and empty passwords at login ([Login security](#login-security)). |
| `PGADMIN_OWNED_ONLY` | `auth.owned_only` | off | Set to `1` to list only the databases the signed-in role owns ([Login security](#login-security)). |
| `APP_DEBUG` | (read in `public/index.php`) | `false` | `true` adds the exception class, message and stack trace to API error responses. |

::: danger APP_DEBUG in production
With `APP_DEBUG=true`, error responses include file paths and stack traces. Use it only to diagnose a problem, then switch it off.
:::

Each variable above was checked by starting phpPgAdmin with it set and reading the result: the login page's default server, where the storage file was created, the Import page's server files, the Export page's "not found" message, and the debugger's status.

## Default server (`config/db.php`) {#default-server}

```php
'host'     => getenv('PGADMIN_DB_HOST') ?: 'localhost',
'port'     => (int) (getenv('PGADMIN_DB_PORT') ?: 5432),
'sslmode'  => getenv('PGADMIN_DB_SSLMODE') ?: 'prefer',
'database' => getenv('PGADMIN_DB_DATABASE') ?: null,
'timeout'  => (int) (getenv('PGADMIN_DB_TIMEOUT') ?: 10),
```

This is the server the login page offers when no login has succeeded yet, and what **Other server…** resets the Advanced fields to. It does not restrict which servers people can sign in to: the login form's **Advanced** section accepts any host and port, and every server a login succeeds against is saved and offered afterwards. See [Signing in](/guide/signing-in#saved-servers).

::: warning Anyone who can reach phpPgAdmin can try any server
The web server connects to whatever host and port the login form names, as pgAdmin in server mode does. Restrict who can reach phpPgAdmin (VPN, firewall, HTTP authentication in front of it) and which hosts the web server may connect to.
:::

`timeout` covers servers that do not answer. With the default of 10, signing in to an address that drops packets fails after about 10 seconds with "timeout expired"; with `PGADMIN_DB_TIMEOUT=3` it failed after 3 seconds.

## Storage (`config/storage.php`) {#storage}

| Key | Default | Notes |
|---|---|---|
| `path` | `storage/phppgadmin.sqlite` | Created, with its directory, on first use; migrated automatically. Like pgAdmin's `pgadmin4.db`. |
| `processes` | `storage/processes` | One subdirectory per background process, holding the uploaded file, the program's output and its status. Removed when you dismiss the process on the Import page. |
| `upload_dir` | `null` | phpMyAdmin's `UploadDir`: for files larger than PHP and the web server accept in one request. Its files are listed on the Import page. |

What the storage database holds, per PostgreSQL role and server:

- saved servers (no passwords), shared by everyone who uses this installation;
- each role's preferences, including its language;
- query history, bookmarks and macros;
- export templates and Designer pages;
- records of background processes.

PostgreSQL passwords are never written to it. See [Signing in](/guide/signing-in#passwords-and-sessions).

::: tip Back it up
The storage file is small and holds everything phpPgAdmin knows that PostgreSQL does not. Back up `storage/` (or `PGADMIN_STORAGE_PATH`) with the application.
:::

## Client programs and the debugger (`config/tools.php`)

| Key | Default | Notes |
|---|---|---|
| `bin_dir` | `null` | When null, phpPgAdmin searches the `PATH`, `/usr/lib/postgresql/*/bin`, `/usr/pgsql-*/bin`, Homebrew's `postgresql@*/bin`, `/usr/local/pgsql/bin`, `/usr/bin` and `/usr/local/bin`, and takes the directory with the newest `pg_dump`. When set, only that directory is used. |
| `php_binary` | `null` | When null, the `php` next to the running PHP (`PHP_BINDIR/php`) is used. Set it when PHP-FPM's directory holds no CLI binary, for example `/usr/bin/php8.3`. |
| `debugger` | `true` | `PGADMIN_DEBUGGER=0` switches it off; the debugger's status then reports "The debugger is switched off (PGADMIN_DEBUGGER=0)." and no **Debug** button appears. |

The debugger also needs the `pldbgapi` extension and `shared_preload_libraries = 'plugin_debugger'` on the server; see [Debugger](/tools/debugger).

## Login security (`config/auth.php`) {#login-security}

Two settings of the classic phpPgAdmin:

- **`extra_login_security`** (`PGADMIN_EXTRA_LOGIN_SECURITY=1`) refuses to sign in `postgres`,
  `pgsql`, `root` and `administrator`, and any role with an empty password, before the server is
  asked: *Login disallowed for security reasons*. A `trust` line in `pg_hba.conf` would otherwise
  let anyone who reaches the site in with any password.
- **`owned_only`** (`PGADMIN_OWNED_ONLY=1`) lists only the databases the signed-in role owns, in
  the navigation panel and on the Databases page. Superusers still see every database. It hides
  names only; PostgreSQL's privileges still decide what a role can connect to.

## Languages (`config/i18n.php`)

```php
'default'  => 'en',
'fallback' => 'en',
'locales'  => [
    'en' => ['name' => 'English', 'native' => 'English', 'dir' => 'ltr'],
    'ar' => ['name' => 'Arabic', 'native' => 'العربية', 'dir' => 'rtl'],
],
```

| Key | Meaning |
|---|---|
| `default` | The language used when nothing else picks one. |
| `fallback` | The language a missing message is taken from. |
| `locales` | The languages the picker offers, by code. `native` is the name shown in the picker ("العربية - Arabic"), `dir` the writing direction the page is laid out in (`ltr` or `rtl`). |

A language needs a `resources/lang/<code>.json` file in every module and in `src/lang/`, and a frontend build that includes them; adding an entry here alone is not enough. See [Translations](/developers/translations).

How the language for a request is chosen, in order:

1. `?lang=<code>` in the address (remembered in the session);
2. the language saved in the session;
3. the `pga_lang` cookie (kept for one year);
4. the browser's `Accept-Language` header (`ar-EG` matches `ar`);
5. `default`.

When you sign in, the language your role saved last time takes over. [Finding your way around](/guide/interface#language-and-right-to-left) describes the picker.

## Modules (`config/modules.php` and `bootstrap/modules.php`)

`config/modules.php` sets the middleware and URL prefixes of the routes the modules provide: `web` for the application page, `api` (under `/api`) for the API, and `nodes` (under `/api`, signed-in sessions only) for the navigation tree's data. These are part of the application; changing them can make the API unreachable or unprotected. Leave this file as it is.

`bootstrap/modules.php` lists the modules the application loads, in order. Removing one removes its pages and tabs, but other modules may depend on it (every page needs Auth, and the SQL module's result grid is used by Browse and Search), so this is a development task, not a configuration option. See [Writing a module](/developers/modules).

## PHP settings that matter

These are `php.ini` (or FPM pool) settings, not phpPgAdmin's:

| Setting | Why |
|---|---|
| `upload_max_filesize`, `post_max_size` | The largest file the Import pages accept as an upload; the page shows the limit. Use `PGADMIN_UPLOAD_DIR` for larger files. |
| `session.gc_maxlifetime` | How long an idle sign-in lasts. PHP's default is 1440 seconds (24 minutes). See [Signing in](/guide/signing-in#passwords-and-sessions). |
| `session.cookie_secure` | phpPgAdmin's session cookie (`PHPSESSID`) is always `HttpOnly` and `SameSite=Lax`, and `Secure` when the request comes over HTTPS. When HTTPS ends at a proxy in front of phpPgAdmin, PHP sees plain HTTP: set `session.cookie_secure = 1` so the cookie is still marked `Secure`. |
| `session.save_path` | Where sessions, which hold the signed-in role's password, are stored. Keep it private to the PHP user. |
| `disable_functions` | Must not include `proc_open` or `exec`. |
| nginx `fastcgi_read_timeout`, Apache `ProxyTimeout`, FPM `request_terminate_timeout` | A query on the SQL tab runs inside one request. With nginx's default of 60 seconds, `SELECT pg_sleep(65)` came back as **504 Gateway Time-out**. Raise the timeout if you run long statements from the browser. |
