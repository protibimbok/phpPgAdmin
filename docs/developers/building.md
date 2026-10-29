# Building from source

This page covers setting up a development checkout: the tools you need, installing PHP and Node dependencies, running the Vite dev server, building production assets, type-checking, working on this documentation site, and how releases and the docs site are published. For installing a release on a server, see [Installation](/guide/installation).

## Prerequisites

| Tool | Version | Used for |
|---|---|---|
| PHP | 8.3 or newer (`composer.json` requires `>=8.3`; the code uses typed class constants) | The application, `artisan`, the background runner |
| PHP extensions | `pgsql`, `pdo_sqlite`, `mbstring`, `session`, `json`; `posix` and `pcntl` recommended; `zlib` for gzipped imports | ext-pgsql for PostgreSQL, PDO SQLite for the app storage, posix/pcntl for stopping background jobs cleanly |
| Composer | 2 | PHP dependencies (`league/route`, `nyholm/psr7`, `nyholm/psr7-server`, `twig/twig`) |
| Node.js | `^20.19.0` or `>=22.12.0` (Vite 8's requirement; CI uses 22) | Vite, TypeScript, VitePress |
| pnpm | 11 (`packageManager` pins `pnpm@11.20.0`; Corepack picks it up) | JavaScript dependencies and scripts |
| PostgreSQL client tools | `pg_dump`, `pg_restore`, `psql` on `PATH` or in `PGADMIN_PG_BIN_DIR` | Export, import, maintenance |
| A PostgreSQL server | 13 or newer | Something to sign in to |

Building the frontend needs PHP too. The Vite plugin runs `php artisan laramod:vite` to learn which module entries to build (see [Writing a module](/developers/modules#how-modules-are-discovered)), and `artisan` needs `vendor/autoload.php`. Run `composer install` before any `pnpm` script that starts Vite.

## Install dependencies

```bash
git clone https://github.com/protibimbok/phpPgAdmin.git
cd phpPgAdmin
composer install
pnpm install
```

`composer.lock` is listed in `.gitignore`, so `composer install` resolves the newest versions allowed by `composer.json` on a fresh checkout.

### pnpm build scripts (`allowBuilds`)

pnpm 11 does not run dependency install scripts that you have not decided on, and the install fails in CI until each one is listed. `pnpm-workspace.yaml` records those decisions:

```yaml
allowBuilds:
  '@parcel/watcher': false   # via sass; ships prebuilt binaries, its script only builds from source
  esbuild: false             # via vitepress; installs its binary as an optional dependency
```

When a new dependency brings an install script, add it here: `true` to run the script, `false` to skip it. Otherwise `pnpm install --frozen-lockfile` fails in the release and docs workflows.

## Serve the application

phpPgAdmin needs a web server that sends every request that is not a real file to `public/index.php`. Any of these works:

- **nginx or Apache** with the document root at `public/`. `public/.htaccess` does the rewrite for Apache. The `.htaccess` in the project root serves `public/` when the document root has to be the project root.
- **PHP's built-in server**, which is enough for development:

  ```bash
  php -S localhost:8000 -t public public/index.php
  ```

  `public/index.php` detects the built-in server and lets it serve real files (favicons, `dist/`) itself.

Set `APP_DEBUG=true` in the PHP environment to get the exception class, message and trace in 500 responses. Connection defaults, storage paths and tool paths come from environment variables read by `config/*.php`; see [Configuration](/guide/configuration).

## Development: `pnpm dev`

```bash
pnpm dev
```

This starts the Vite dev server (`vite`, port 5173). `laravel-vite-plugin`, wrapped by `laramod-vite-plugin`, writes the server's URL to `public/hot` (for example `http://[::1]:5173`). While that file exists, `app/Core/Frontend/Vite.php` points the HTML shell's script tags at the dev server and adds the React Refresh preamble, so you get hot module replacement. Open the app through your PHP server, not through port 5173.

With `refresh: true` the plugin also reloads the page when a module's `routes/**` or `lang/**` change. It restarts the dev server when `bootstrap/modules.php` or a module class changes, because the list of entries is decided in PHP.

::: warning A stale `public/hot` blanks the app
If the dev server dies without cleaning up, `public/hot` stays behind and every page loads scripts from a server that is not running, so the page stays empty. Delete `public/hot`, or start `pnpm dev` again.
:::

::: info The dev server must be reachable from the browser
The shell sends the browser to the URL in `public/hot`. With the default `[::1]:5173`, that works only when the browser runs on the same machine as Vite.
:::

## Production build: `pnpm build`

```bash
pnpm build        # tsc -b && vite build
```

This type-checks, then builds `src/main.tsx` and every module entry into `public/dist/` with a `manifest.json`. Without `public/hot`, the shell reads that manifest to write the stylesheet, script and `modulepreload` tags. `public/dist/` is git-ignored.

Delete `public/hot` before testing a production build locally, or the shell keeps using the dev server.

## Type-check: `pnpm typecheck`

```bash
pnpm typecheck    # tsc -b
```

TypeScript 7 builds the project references in `tsconfig.json`: `tsconfig.app.json` for `src` and `Modules/*/resources/js`, and `tsconfig.node.json` for `vite.config.ts`. It is strict (`noUnusedLocals`, `noUnusedParameters`, `noUncheckedSideEffectImports`…) and emits nothing. A clean run takes about a second and prints only `$ tsc -b`.

There is no PHP test suite and no PHP linter configuration. Run `php -l` on the files you change, and exercise the API with `curl` or the app itself.

## The documentation site

The docs are a VitePress site in `docs/`. The `demo/` and `scripts/` folders are excluded from the pages (`srcExclude`).

```bash
pnpm docs:dev       # vitepress dev docs, with hot reload
pnpm docs:build     # vitepress build docs → docs/.vitepress/dist
pnpm docs:preview   # serve the built site
```

The site is served from `/phpPgAdmin/`. Set `DOCS_BASE=/` (or another path) when building for a custom domain. Short screen recordings are embedded with the `<Clip src="area/name.mp4" caption="…" />` component from `docs/.vitepress/theme/Clip.vue`. It reads files from `docs/public/media/`.

### Demo cluster

Screenshots are taken against a separate PostgreSQL cluster, so they show only the demo database:

```bash
docs/scripts/demo-cluster.sh start   # initdb on first run, start, seed "bookshop"
docs/scripts/demo-cluster.sh stop
```

| Variable | Default | |
|---|---|---|
| `DOCS_PG_DATA` | `~/.cache/phppgadmin-docs/pgdata` | Data directory |
| `DOCS_PG_PORT` | `5499` | Port; the cluster listens on `localhost` only, trust authentication, superuser `postgres` |

On first start the script runs `initdb` and appends to `postgresql.conf`: `shared_preload_libraries = 'plugin_debugger'`, `wal_level = logical`, `logging_collector = on` with `stderr,csvlog,jsonlog`, `log_min_duration_statement = 0` and `track_functions = all`. That gives the Debugger, Logs and Replication pages something to show. It then seeds `bookshop` and creates the `pldbgapi` extension. It needs `initdb` and `pg_ctl` on `PATH`, and the pldebugger package installed, or the cluster does not start.

`docs/scripts/reset-demo.sh` drops and recreates `bookshop` from `docs/demo/seed.sql`. It honours `PGHOST`, `PGPORT` and `PGUSER`, and defaults to the docs cluster (`localhost:5499`, `postgres`):

```bash
docs/scripts/reset-demo.sh
```

### Regenerating screenshots

`docs/scripts/capture.mjs` holds the Playwright helpers. The capture scripts in `docs/scripts/captures/*.mjs` use it, one per area, and each can be run on its own:

```bash
node docs/scripts/captures/server-databases.mjs
```

`docs/scripts/capture-all.sh` regenerates everything: it rebuilds the docs cluster from scratch and runs every capture script in turn (they share the cluster, so never run them in parallel). Pass area names to run only those, such as `capture-all.sh sql table`, and set `KEEP_CLUSTER=1` to reuse the running cluster.

| Helper | What it does |
|---|---|
| `open(route, opts)` | Opens a 1280×800 page signed in to the demo cluster (it fills the login form's **Advanced** host and port), then goes to `route`. Returns `{ page, context, close }`. Pass `{ login: false }` to stay on the login page. |
| `shot(page, 'area/name.png', { selector, pad, fullPage })` | Saves a PNG under `docs/public/media/`: the viewport, one element with `pad` pixels around it (default 8), or the full page. |
| `record('area/name.mp4', route, steps)` | Records `steps(page)` and converts the WebM to H.264 MP4 with `ffmpeg` (no audio, CRF 28). |
| `type(page, selector, text)` | Types one key at a time so it shows in a recording. |
| `settle(page, ms)` | Waits for network idle plus `ms` (default 400). |
| `done()` | Closes the browser. |

| Variable | Default |
|---|---|
| `DOCS_APP_URL` | `http://phppgadmin.test` |
| `DOCS_PG_HOST`, `DOCS_PG_PORT` | `localhost`, `5499` |
| `DOCS_PG_USER`, `DOCS_PG_PASSWORD` | `postgres`, empty |
| `CHROME` | `/usr/bin/google-chrome-stable` |

The scripts use `playwright-core`, which does not download a browser. Point `CHROME` at an installed Chrome or Chromium. `record()` also needs `ffmpeg` on `PATH`. The app has to be running at `DOCS_APP_URL`, either with `pnpm dev` or with a build.

::: info Signing in saves the server
Each capture signs in through the login form, and a successful login adds `localhost:5499` to the app's saved servers in `storage/phppgadmin.sqlite`. Your own checkout keeps that entry until you remove it.
:::

## Releases

`.github/workflows/release.yml` runs when a tag matching `vX.Y.Z` is pushed:

```bash
git tag v0.1.0
git push origin v0.1.0
```

The job:

1. Sets up PHP 8.3 (with `pgsql`, `pdo_sqlite` and Composer 2), pnpm and Node 22.
2. Runs `composer install` (with dev dependencies, so `artisan` can answer the Vite plugin), `pnpm install --frozen-lockfile` and `pnpm build`.
3. Runs `composer install --no-dev --optimize-autoloader`.
4. Copies `app bin bootstrap config Modules public vendor composer.json` into `phpPgAdmin-X.Y.Z/` with `rsync`. It leaves out `Modules/*/resources/js`, `scss` and `img` (they are bundled into `public/dist`) and `public/hot`. Module `resources/lang` and `resources/sql` are kept, because PHP reads them at runtime. It adds an empty `storage/`.
5. Zips the folder and attaches `phpPgAdmin-X.Y.Z.zip` to a GitHub release with generated notes.

The version shown in `package.json` (`0.1.0`) and `App::VERSION` (`0.1.0-dev`) are not derived from the tag. Update them by hand before tagging.

::: warning The release zip has no root `.htaccess`
The rsync list does not include the project root's `.htaccess`, only `public/.htaccess`. A release unpacked under an Apache document root that points at the project root (not at `public/`) gets no rewrite to `public/`: the app does not load at `/`, and `config/`, `storage/` and `vendor/` are reachable by URL unless the vhost denies them. Point the document root at `public/`, or copy `.htaccess` from the repository. The zip has no `src/`, `artisan`, `package.json` or `docs/` either, so you cannot rebuild assets from a release. Use a git checkout for that.
:::

## Docs deployment

`.github/workflows/docs.yml` builds the site and publishes it to GitHub Pages. It runs on pushes to `master` that touch `docs/**` or the workflow file, and on demand (**Run workflow**, `workflow_dispatch`).

1. Checks out with full history (`fetch-depth: 0`), because VitePress's "Last updated" reads each page's git log.
2. Runs `pnpm install --frozen-lockfile` and `pnpm docs:build`.
3. Uploads `docs/.vitepress/dist` with `actions/upload-pages-artifact` and deploys it with `actions/deploy-pages`.

Before the first run, enable Pages once in the repository: **Settings → Pages → Build and deployment → Source: GitHub Actions**. The site then appears at `https://<owner>.github.io/phpPgAdmin/`. For a custom domain, set the `DOCS_BASE` environment variable on the build step (for example `DOCS_BASE: /`) so asset URLs and the favicon resolve.
