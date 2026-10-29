# Installation

This page covers installing phpPgAdmin with phnx, from a release zip or from source, setting up the web server, the PHP extensions and PostgreSQL client programs it needs, and upgrading. Once it is installed, see [Configuration](/guide/configuration) and [Signing in](/guide/signing-in).

## Requirements

| What | Needed for | Notes |
|---|---|---|
| PHP 8.3 or newer | Everything | `composer.json` requires `php >= 8.3`. |
| `pgsql` extension | Everything | All PostgreSQL connections go through libpq. The server home page shows the libpq version as **Database client version**. |
| `pdo_sqlite` extension | Everything | phpPgAdmin's own storage (saved servers, preferences, history, bookmarks) is an SQLite file. |
| `mbstring`, `ctype`, `zlib`, `session` | Everything | Bundled with most PHP builds. `zlib` compresses gzipped exports. |
| `proc_open` and `exec` allowed | Export, Import, Maintenance, Debugger | They must not be in `disable_functions`. |
| `posix`, `pcntl` | Optional | Used for background processes when present. |
| PostgreSQL client programs | Export, Import, Maintenance | `pg_dump`, `pg_dumpall`, `pg_restore` and `psql`. See [Client programs](#postgresql-client-programs). |
| PostgreSQL 13 or newer | Everything | The server you sign in to. Nothing is installed on it. |

Check the PHP side with:

```sh
php -v
php -m | grep -E 'pgsql|pdo_sqlite|mbstring|ctype|zlib|session'
```

::: tip PHP-FPM and the CLI can differ
The web server's PHP (PHP-FPM or mod_php) can have other extensions and `php.ini` settings than the `php` command. The **Web server** card on the server home page shows the PHP version the web server runs.
:::

## With phnx

[phnx](https://github.com/protibimbok/phnx) sets up local PHP development on Linux and macOS: nginx sites, PHP-FPM pools, `/etc/hosts` entries, MariaDB or PostgreSQL, and helper tools. It installs phpPgAdmin as one of those tools, so this is the quickest way to run it on your own machine. For a shared server, use a [release zip](#from-a-release-zip) behind your own web server.

1. Install phnx and run its first-time setup. phnx needs nginx installed; `phnx configure` can install PHP-FPM.

   ```sh
   curl -fsSL https://raw.githubusercontent.com/protibimbok/phnx/master/scripts/install.sh | bash
   phnx configure
   ```

   phnx is also packaged for Homebrew, apt, the AUR (`phnx-bin`), rpm and apk; see its README. Run it as your own user, not root: it uses `sudo` for the steps that need it.

2. Install phpPgAdmin:

   ```sh
   phnx setup phppgadmin
   ```

   This:
   - sets up PostgreSQL first if phnx has not yet (`phnx setup postgres`): it installs and starts the server if there is none, and creates a superuser role, `phnx` with the password `secret` by default;
   - offers to install the PL/pgSQL debugger (see step 4);
   - downloads the latest [release zip](https://github.com/protibimbok/phpPgAdmin/releases), checks its SHA-256 digest and unpacks it into `~/.phnx/tools/phppgadmin`;
   - writes `config/db.php` so the login page offers the PostgreSQL server phnx set up;
   - registers the site with PHP 8.3 or newer at `http://phppgadmin.test` (the `.test` suffix is phnx's `tld` setting).

3. Make sure that PHP has the `pgsql` and `pdo_sqlite` extensions:

   ```sh
   phnx php ext install pgsql sqlite3
   ```

4. Optional: for the [Debugger](/tools/debugger), run `phnx setup pgdebugger` (if you skipped it in step 2). It installs the pldebugger plugin, adds `plugin_debugger` to `shared_preload_libraries`, restarts PostgreSQL and creates the `pldbgapi` extension in every database, `template1` included, so new databases have it too.

5. Open `http://phppgadmin.test` and [sign in](/guide/signing-in) with the role phnx created (`phnx` / `secret` unless you changed it), or any other role.

Run `phnx secure phppgadmin` to serve it over HTTPS with a certificate from phnx's local CA.

::: tip Check that your phnx has the command
`phnx setup --help` lists `phppgadmin` and `pgdebugger` in versions of phnx that include them. Update phnx if they are missing.
:::

To upgrade, run `phnx setup phppgadmin` again: it unpacks the newest release over the old one and keeps `storage/` (saved servers, preferences, history and bookmarks). Because it rewrites the files in `~/.phnx/tools/phppgadmin`, set any configuration of your own through [environment variables](/guide/configuration#environment-variables) rather than by editing `config/*.php`.

## From a release zip

Each release on [GitHub Releases](https://github.com/protibimbok/phpPgAdmin/releases) has a `phpPgAdmin-X.Y.Z.zip`. It is ready to serve: the frontend is already built into `public/dist/` and the PHP dependencies are in `vendor/` (no development packages).

The zip holds:

| Path | What it is |
|---|---|
| `app/`, `bootstrap/`, `Modules/` | The PHP code. Each module keeps its SQL templates and translations here; its JavaScript is in the build. |
| `bin/` | `process-runner.php` and `debugger-session.php`, which run imports, maintenance and debugger sessions in the background. |
| `config/` | The configuration files. See [Configuration](/guide/configuration). |
| `public/` | The document root: `index.php`, the built assets in `dist/`, favicons, and an `.htaccess` for Apache. |
| `vendor/` | Composer's dependencies and autoloader. |
| `storage/` | Empty. phpPgAdmin creates its SQLite database here the first time it runs. |
| `.htaccess` | For Apache when the document root has to be the project root: it serves `public/` without `/public` in the URLs. See [Web server](#web-server). |

1. Unpack the zip where the web server can read it, for example `/var/www/phppgadmin`.
2. Make `storage/` writable by the web server's user (see [Writable storage](#writable-storage)).
3. Point the web server at `public/` (see [Web server](#web-server)).
4. Open the site and [sign in](/guide/signing-in).

## From source

You need Git, Composer 2, Node.js 22 and pnpm (the repository pins pnpm 11 in `package.json`).

```sh
git clone https://github.com/protibimbok/phpPgAdmin.git
cd phpPgAdmin
composer install --no-dev --optimize-autoloader
pnpm install
pnpm build
```

`pnpm build` type-checks the TypeScript and builds the frontend into `public/dist/`. The build runs `php artisan laramod:vite` to find each module's frontend files, so the `php` command and the Composer autoloader must work at that point. If you install without `--no-dev`, run `composer install --no-dev --optimize-autoloader` again after the build, as the release workflow does.

[Building from source](/developers/building) covers the development setup (`pnpm dev`, hot reload).

::: warning Remove public/hot before serving a build
While `pnpm dev` runs, Vite writes its address to `public/hot`, and phpPgAdmin loads its scripts from the dev server instead of `public/dist/`. If that file is left behind, for example after the dev server was killed, the page stays blank. Delete `public/hot` on any server that serves a build.
:::

::: info No composer.lock
The repository does not commit `composer.lock`, so `composer install` resolves the newest versions allowed by `composer.json`. The release zip ships the versions resolved when it was built.
:::

## Web server

phpPgAdmin is a single-page application with one PHP entry point, `public/index.php`. Every address except a real file under `public/` must reach `index.php`, including the `/api/...` addresses the pages call.

::: warning Serve it from the root of a host name
The pages load their assets from `/dist/...` and call `/api/...` with absolute paths, so phpPgAdmin does not work under a sub-path such as `https://example.com/phppgadmin/`. Give it its own host name (`pga.example.com`) or port.
:::

Only `public/` should be reachable from the web. `config/`, `storage/` (which holds the SQLite database) and `vendor/` must stay outside the document root.

### nginx with PHP-FPM

```nginx
server {
    listen 80;
    server_name pga.example.com;
    root /var/www/phppgadmin/public;
    index index.php;

    # Imports upload files: allow bodies as large as PHP's post_max_size.
    client_max_body_size 64m;

    # Real files (dist/, favicons) as they are; every other path goes to the front controller.
    location / {
        try_files $uri $uri/ /index.php?$query_string;
    }

    location ~ \.php$ {
        fastcgi_pass unix:/run/php-fpm/php-fpm.sock;   # your PHP-FPM socket or host:port
        fastcgi_split_path_info ^(.+\.php)(/.*)$;
        fastcgi_param SCRIPT_FILENAME $document_root$fastcgi_script_name;
        fastcgi_param PATH_INFO $fastcgi_path_info;
        include fastcgi_params;
        # A statement on the SQL tab runs inside one request; nginx's default is 60 s.
        fastcgi_read_timeout 300s;

        # Configuration, read by config/*.php (see Configuration):
        # fastcgi_param PGADMIN_DB_HOST db.internal;
        # fastcgi_param PGADMIN_PG_BIN_DIR /usr/lib/postgresql/18/bin;
    }

    location ~ /\.(?!well-known).* {
        deny all;
    }

    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
}
```

The site these pages were checked against runs on this configuration, without the `client_max_body_size` and `fastcgi_read_timeout` lines. Use HTTPS in production: the login form sends the PostgreSQL password to phpPgAdmin.

### Apache

**Document root at `public/` (recommended).** `public/.htaccess` sends every path that is not a file to `index.php`, passes the `Authorization` header through, and redirects a hand-typed `/public/...` URL to the same path without it. It needs `mod_rewrite` and `AllowOverride FileInfo` (or `All`) for the directory.

```apache
<VirtualHost *:443>
    ServerName pga.example.com
    DocumentRoot /var/www/phppgadmin/public

    <Directory /var/www/phppgadmin/public>
        AllowOverride All
        Require all granted
    </Directory>

    # With PHP-FPM:
    <FilesMatch "\.php$">
        SetHandler "proxy:unix:/run/php-fpm/php-fpm.sock|fcgi://localhost"
    </FilesMatch>

    # Configuration, read by config/*.php (see Configuration):
    # SetEnv PGADMIN_DB_HOST db.internal
</VirtualHost>
```

**Document root at the project root.** On shared hosting you often cannot move the document root. The `.htaccess` in the project root rewrites every request into `public/`, so URLs do not show `/public`, and files outside `public/` (`config/`, `storage/`, `vendor/`, `.git/`) are never served: a request for one of them gets the application page instead. Without `mod_rewrite` the file denies every request.

::: details What was checked
With Apache 2.4 and the project root as the document root, `/` and `/server/databases` returned the application, `/public/server/databases` redirected to `/server/databases`, `/api/auth/servers` returned JSON, and `/config/db.php`, `/storage/phppgadmin.sqlite`, `/vendor/autoload.php` and `/.git/HEAD` all returned the application page, not the file. Signing in through it worked.
:::

### PHP's built-in server

For a quick local try-out:

```sh
php -S localhost:8080 -t public public/index.php
```

`public/index.php` lets the built-in server deliver real files itself and handles everything else. Do not use it for anything other than local use.

## Writable storage

phpPgAdmin keeps its own data in an SQLite database, `storage/phppgadmin.sqlite` by default. It creates the file, and the directory if needed, on first use, and runs its migrations automatically. The web server's user needs write access to:

| Path | Holds |
|---|---|
| `storage/phppgadmin.sqlite` (and the `-wal` and `-shm` files next to it) | Saved servers, preferences, query history, bookmarks, macros, export templates, designer pages, background process records. |
| `storage/cache/twig/` | Compiled SQL templates. |
| `storage/processes/` | One directory per import, maintenance run or debugger session: the uploaded file, the program's output and its status. |

```sh
sudo chown -R www-data: /var/www/phppgadmin/storage   # the user PHP-FPM runs as
```

SQLite needs to create files in the directory, so the directory itself must be writable, not only the database file. To keep the data outside the application directory (useful for upgrades), set `PGADMIN_STORAGE_PATH`; the cache moves with it. See [Configuration](/guide/configuration#storage).

::: warning An unwritable storage directory
If PHP cannot create or open the database, every API call fails with **Internal Server Error** and the login form reports it when you try to sign in. With `APP_DEBUG=true` the response names the cause (`unable to open database file`).
:::

## PostgreSQL client programs

[Export](/tools/export), [Import](/tools/import) and [Maintenance](/tools/maintenance) run PostgreSQL's own programs, as pgAdmin does:

| Program | Used by |
|---|---|
| `pg_dump` | Export of a database, schema or table (SQL, custom and tar archives). |
| `pg_dumpall` | Export of the whole server. |
| `psql` | CSV export, SQL file import, CSV import, Maintenance (VACUUM, ANALYZE, REINDEX, CLUSTER). |
| `pg_restore` | Import of a custom or tar archive. |

They must be installed on the web server, not the database server (on Debian and Ubuntu, the `postgresql-client` package; on RHEL, `postgresqlNN`).

When `PGADMIN_PG_BIN_DIR` is not set, phpPgAdmin looks for `pg_dump` in every directory on the `PATH` and in `/usr/lib/postgresql/*/bin`, `/usr/pgsql-*/bin`, Homebrew's `postgresql@*/bin`, `/usr/local/pgsql/bin`, `/usr/bin` and `/usr/local/bin`, and uses the directory with the newest one. The other programs are taken from the same directory.

::: warning pg_dump must be at least as new as the server
`pg_dump` refuses to dump a server newer than itself. If several versions are installed, the newest is picked automatically; if you set `PGADMIN_PG_BIN_DIR`, point it at a version at least as new as every server you export from.
:::

When the programs are missing, the Export page says "pg_dump was not found on the web server. Set PGADMIN_PG_BIN_DIR (config/tools.php) to the directory of the PostgreSQL client programs.", and the Import and Maintenance pages show similar messages. When the `pg_dump` found is older than the server, Export says "pg_dump 16.4 cannot export from a PostgreSQL 18 server" (with the versions found). The rest of phpPgAdmin works without the programs.

The programs run with the signed-in role's credentials. The password is passed in the `PGPASSWORD` environment variable, never on a command line.

## Optional PostgreSQL extensions

These are installed in a database, on the database server:

| Extension | Effect |
|---|---|
| `pgstattuple` | The table and materialized view statistics add tuple and free-space figures (tuple count, tuple length, dead tuples, free space). Without it, the statistics come from `pg_stat_all_tables` only. |
| `pldbgapi` (EDB's pldebugger) | Enables the [Debugger](/tools/debugger) for PL/pgSQL functions and procedures. The server also needs `shared_preload_libraries = 'plugin_debugger'` and a restart. Without both, no **Debug** button appears. |

```sql
CREATE EXTENSION pgstattuple;
CREATE EXTENSION pldbgapi;
```

## Upgrading

With phnx, run `phnx setup phppgadmin` again (see [With phnx](#with-phnx)). Otherwise:

1. Keep `storage/` (or the directory `PGADMIN_STORAGE_PATH` points at). It holds your saved servers, preferences, history and bookmarks.
2. Keep your configuration. If you edited `config/*.php`, the new release overwrites those files, so setting the [environment variables](/guide/configuration#environment-variables) in the web server is easier to carry over.
3. Replace everything else with the new release: unpack the new zip and move `storage/` into it, or, from source, `git pull`, then `composer install --no-dev --optimize-autoloader` and `pnpm install && pnpm build`.
4. Reload PHP-FPM if you use OPcache with timestamp validation switched off.

The storage database is migrated automatically on the next request. Compiled SQL templates in `storage/cache/twig/` are rebuilt when their source changes, so you do not need to clear the cache.

Signed-in sessions keep working across an upgrade, but reload open browser tabs so they load the new frontend.
