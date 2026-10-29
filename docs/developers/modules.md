# Writing a module

Every feature of phpPgAdmin is a module under `Modules/<Name>/`: a PHP class that declares what it provides, its routes and controllers, its messages, its SQL templates and a frontend script that registers pages and tabs. This page builds one end to end and uses the real Search module (the database-level **Search** tab) as the worked example. Read [Architecture](/developers/architecture#module-system) first for how the kernel wires modules in.

## Layout

```text
Modules/Search/
  SearchModule.php                       the module class
  routes/api.php                         API routes
  Http/Controllers/SearchController.php  controller
  resources/
    js/app.tsx                           frontend entry: registerModule()
    js/api.ts                            typed API calls
    js/Pages/Search.tsx                  the page
    lang/en.json, lang/ar.json           messages, PHP and i18next
    sql/search_objects/default/search.sql   Twig SQL template
```

Optional parts used by other modules:

| Path | Contract | Example |
|---|---|---|
| `routes/web.php` | `ProvidesRoutes` | Frontend (the HTML shell) |
| `Http/Middleware/` | (used from routes or `ProvidesGlobalMiddlewares`) | Auth, I18n |
| `database/migrations/*.php` | `ProvidesMigrations` | Sql, Import, Export, Designer, Auth |
| `resources/sql/<node>/…` with `nodes()` | `ProvidesNodes` | Sequences, Tables; see [SQL templates and nodes](/developers/nodes) |
| `resources/js/preferences.ts` | (imported by `app.tsx`) | Sql, Export, Import |
| `resources/scss/`, `resources/img/` | (imported from TypeScript) | Auth's login page |

## The module class

`Modules/Search/SearchModule.php`:

```php
namespace PhpPgAdmin\Modules\Search;

final class SearchModule implements Module, ProvidesApiRoutes, ProvidesSqlTemplates,
    ProvidesTranslations, ProvidesViteEntries, ProvidesFrontendScripts
{
    public function name(): string { return 'search'; }

    public function path(): string { return __DIR__; }

    public function apiRoutes(): void { require __DIR__ . '/routes/api.php'; }

    public function sqlTemplatesPath(): string { return 'resources/sql'; }

    public function translationsPath(): string { return 'resources/lang'; }

    public function viteEntries(): array { return ['resources/js/app.tsx']; }

    public function frontendScripts(): array { return ['resources/js/app.tsx']; }
}
```

- `name()` is the module's id. It must be unique, and it becomes the PHP translation namespace (`search::…`) and the Vite alias (`@search`).
- `path()` is the root that the other paths are relative to. An absolute path returned by any method is used as it is.
- Classes autoload through Composer's PSR-4 mapping `PhpPgAdmin\Modules\` → `Modules/`, so a new module needs no change to `composer.json`.
- Implement only the contracts you need. The Settings module, for example, has no PHP routes: it implements `ProvidesTranslations`, `ProvidesViteEntries` and `ProvidesFrontendScripts` and stores values through the Auth module's `/api/preferences`.

::: warning Keep the module name equal to the directory name in lower case
PHP registers messages under `name()`. The frontend's i18n derives the namespace from the directory, lower-cased (`Modules/SchemaDiff` → `schemadiff`). If the two differ (`schema-diff` in a `SchemaDiff` directory), PHP and the browser read different namespaces. Every current module follows the rule.
:::

## How modules are discovered

Nothing is scanned. A module exists once its class is listed in `bootstrap/modules.php`:

```php
return [
    I18nModule::class,
    AuthModule::class,
    // …
    SearchModule::class,
    SettingsModule::class,
    // …
    SqlModule::class,
    FrontendModule::class,
];
```

The list order is the wiring order. It decides the order of route registration, template roots, migrations of the same date, and the order in which the shell loads frontend scripts. A module can move itself with `Ordered::order()`: lower values come first and negative values come last. The Frontend module returns `-1` so its catch-all route is registered after every other route.

The same list drives the frontend build. `laramod-vite-plugin` does not look at the file system. It runs `php artisan laramod:vite`, which boots the registry from `bootstrap/modules.php` and prints each module with its Vite entries:

```bash
$ php artisan laramod:vite
{
    "modules": [
        …
        {
            "name": "search",
            "path": "Modules/Search",
            "file": "Modules/Search/SearchModule.php",
            "entries": [
                "Modules/Search/resources/js/app.tsx"
            ]
        },
        …
```

`artisan` here is a small stand-in for Laravel's and knows only this command (`php artisan` lists it; any other command exits with status 1). From that output the plugin:

- adds every entry to Vite's `input`;
- creates an alias `@<name>` → `Modules/<Dir>/resources` for each module that has a `resources` directory, and mirrors the aliases into `compilerOptions.paths` of `tsconfig.app.json`, so the editor and `tsc` resolve them;
- restarts the dev server when `bootstrap/modules.php` or a module class changes.

After you add a module, expect a diff in `tsconfig.app.json`. Commit it with the module.

::: warning `@types` is a module alias
The Types module's alias is `@types/*` → `Modules/Types/resources/*`. It is the same prefix as npm's `@types` scope, so do not import anything from `@types/…` by path. Pick module names that do not collide with npm scopes you use.
:::

## Routes

`routes/api.php` is plain PHP, `require`d inside the `api` group, so every path gets the `/api` prefix and the `StartSession`, `SetLocale` and `ParseJsonBody` middleware:

```php
use PhpPgAdmin\Core\Facades\Route;
use PhpPgAdmin\Modules\Auth\Http\Middleware\Authenticate;
use PhpPgAdmin\Modules\Search\Http\Controllers\SearchController;

Route::middleware(Authenticate::class)->controller(SearchController::class)->group(function (): void {
    Route::get('/databases/{db}/search/options', 'options')->setName('search.options');
    Route::post('/databases/{db}/search/data', 'data')->setName('search.data');
    Route::post('/databases/{db}/search/objects', 'objects')->setName('search.objects');
});
```

The `Route` facade (`app/Core/Facades/Route.php`) is a thin Laravel-style layer over league/route:

| Call | Effect |
|---|---|
| `Route::get/post/put/patch/delete/options/any($path, $handler)` | Registers a route; returns league's `Route`, so `->setName()` works |
| `Route::prefix('auth')->…->group(fn)` | Prefixes the paths inside |
| `Route::middleware(A::class, B::class)->…->group(fn)` | Adds PSR-15 middleware (class names, created lazily) to the routes inside, after the outer groups' middleware |
| `Route::controller(C::class)->group(fn)` | Lets the routes inside name an action by method: `'options'` means `[C::class, 'options']`. An unknown method throws when the route is registered. |
| `Route::group(['prefix' => …, 'middleware' => […], 'controller' => …], fn)` | The same with an array |

A handler can also be a closure, `[Class::class, 'method']`, an invokable class name or a `RequestHandlerInterface`. Path parameters use league/route's syntax: `{db}`, `{id:number}`, `{id:[0-9a-f]{24}}`.

::: warning Authenticate is per route group, not automatic
The `api` group only starts the session. Wrap every route that touches PostgreSQL in `Route::middleware(Authenticate::class)`. Without it, `ConnectionPool::from($request)` throws a `LogicException` ("No connection pool on the request"), which reaches the client as a bare 500. The generated [node routes](/developers/nodes) are the exception: their group already includes `Authenticate`.
:::

::: info Decode `{db}` yourself
Route parameters arrive percent-encoded as they were in the URL. Controllers call `rawurldecode($args['db'])` before using a database name (`SearchController::connection()` does this), so names with spaces or non-ASCII characters work.
:::

Web routes (`ProvidesRoutes`, `routes/web.php`) are rare. Only the Frontend module has one, the catch-all that serves the HTML shell for every path outside `/api`. Pages are client-side routes, registered from the frontend script.

## Controllers

A controller is a plain class created with `new`. An action takes the PSR-7 request and the route parameters, and returns an array (sent as JSON) or a `ResponseInterface`:

```php
final class SearchController
{
    public function objects(ServerRequestInterface $request, array $args): array
    {
        $input = (array) ($request->getParsedBody() ?? []);   // JSON body, decoded by ParseJsonBody
        $text = (string) ($input['text'] ?? '');
        if (mb_strlen(trim($text)) < 3) {
            throw new BadRequestException('Enter at least three characters of the name.');
        }

        $conn = ConnectionPool::from($request)->for(rawurldecode((string) $args['db']));

        $sql = Sql::render('search_objects', 'search.sql', [
            'search_text' => str_replace("'", "''", mb_strtolower($text)),
            'obj_type' => $type,
            // …
        ], $conn->version());

        return ['results' => array_map(/* shape each row */, $conn->rows($sql))];
    }
}
```

What a controller usually reaches for:

| Need | Use |
|---|---|
| A connection to a database | `ConnectionPool::from($request)->for($db)`; `->maintenance()` for server-wide catalog queries |
| The signed-in role | `ConnectionPool::from($request)->username()`, or the `user` request attribute |
| Run SQL | `$conn->rows($sql, [$param])`, `row()`, `scalar()`, `exec()`, `queryMulti()`, `transaction()` |
| Quote names in SQL you build | `Quoting::ident($schema, $name)`, `Quoting::literal($value)` |
| A version-specific SQL template | `Sql::render($dir, $file, $vars, $conn->version())` |
| Another module's node definition | `Nodes::find('table')`, `Nodes::get('schema')` |
| A config value | `Config::get('tools.bin_dir')` |
| A translated message | `__('search::data.no_text')` |
| App storage | `Storage::connection()` (PDO SQLite) |
| Fail with a status | throw league's `BadRequestException`, `NotFoundException`, `GoneException`…; `ApiException(422, $message, ['remedy' => …])` for extra fields |
| A long request | `session_write_close()` before the slow part, so the browser's other requests are not blocked on the session lock |

A `QueryException` from PostgreSQL needs no handling: `ApiStrategy` turns it into a JSON error with the server's message, SQLSTATE, detail, hint and position, and picks the status from the SQLSTATE. Catch it only to change the status. The Search controller rethrows a failed count as `ApiException(422, …)` because a regular expression the user typed is not a server fault.

`Search::data()` is a good model for building SQL from user input. Relation names are checked against a catalog query before use, identifiers go through `Quoting::ident()`, and search patterns through `Quoting::literal()`.

## SQL templates

`resources/sql/search_objects/default/search.sql` is pgAdmin's search query ported to Twig. It imports a core macro:

```twig
{% import 'macros/catalogs.sql' as CATALOGS %}
SELECT obj_type, obj_name, …
    CASE WHEN {{ CATALOGS.IS_CATALOG_SCHEMA('sn.schema_name') }} THEN …
```

A module that ships templates implements `ProvidesSqlTemplates`. Its `resources/sql` becomes one more template root. Folders inside are template directories (`search_objects`), each with version folders (`default`, `15_plus`…). How versions are chosen, the helper filters and how to port a pgAdmin template are in [SQL templates and nodes](/developers/nodes#sql-templates).

## Messages

`resources/lang/en.json` is nested JSON in i18next's format, read by both sides:

```json
{
  "tab": "Search",
  "data": {
    "no_text": "Enter the words or values to search for.",
    "matches_one": "{{count}} match in <strong>{{table}}</strong>",
    "matches_other": "{{count}} matches in <strong>{{table}}</strong>"
  }
}
```

- PHP: `__('search::data.no_text')`, `__('search::data.matches', ['count' => 3, 'table' => 'books'])`.
- React: `const { t } = useTranslation('search')`, then `t('data.no_text')`; or `t('search:tab')` from anywhere.

Add the same keys to every other locale's file (`ar.json`). Missing keys fall back to English. See [Translations](/developers/translations).

## Frontend script

`resources/js/app.tsx` runs before the application starts and registers the module:

```tsx
import { insertAfter, registerModule } from '@/modular'
import Search from './Pages/Search'

// The Search tab where phpMyAdmin has it on a database, after SQL.
registerModule({
  id: 'search',
  order: 21,
  menuFilter: (menu) =>
    insertAfter(menu, { label: 'sql:tab', level: 'database' },
      { label: 'search:tab', icon: 'b_search', path: '/db/:db/search', level: 'database' }),
  routes: [{ path: 'db/:db/search', element: <Search /> }],
})
```

| Field | What it is |
|---|---|
| `id` | Unique; a second registration with the same id throws |
| `order` | Sort key for the registrations: non-negative from the start, negative from the end, ties in script load order (the PHP module order). It decides which `menuFilter` sees the menu first. |
| `menuFilter(menu)` | Receives the tab list the modules before it built, every level at once, and returns the new list. Use `insertAfter`/`insertBefore` with `{ label, level }` to place a tab next to another module's tab, or append. |
| `routes` | React Router route objects rendered inside the layout. Paths have no leading `/`. |
| `fills` | React nodes kept mounted for the whole session, for content placed into a layout slot such as the navigation tree |

A tab (`MenuItem`) is `{ label, icon, path, level?, kinds? }`:

- `label` is an i18n key with its namespace (`'search:tab'`), translated when the bar renders.
- `icon` is the name of a 16px icon in `src/img/icons` (`b_search`). It must also be listed in `$icons` in `src/styles/_icons.scss`, or no icon class is generated.
- `path` starts with `/` and may use `:db`, `:schema`, `:kind` and `:table`, which are filled from the current level.
- `level` is `server` (the default), `database`, `schema` or `table`.
- `kinds` limits a table-level tab to `table`, `view` and/or `mview`.

The Search tab sits after the SQL module's tab. The SQL module registers with `order: 20`, so `order: 21` makes the Search filter run after it, when the SQL tab is already in the list. If the tab you name is not there yet, `insertAfter` appends to the end.

Other registries a frontend script can use:

| Function | From | For |
|---|---|---|
| `registerNodeLink(type, fn)`, `registerContainerLink(type, fn)` | `@/nodes/links` | The page a tree node (or its folder) opens; also used by the search results and dependency lists |
| `registerPreferences([...])`, `registerPreferenceGroups([...])` | `@/preferences` | Settings shown on the Settings tab |
| `<NavigationTree.Fill>` in `fills` | `@/layout/NavigationTree` | The navigation tree (Databases module) |

The full frontend toolkit (request layer, levels, notifications, modals, styling) is described in [Frontend](/developers/frontend).

::: warning Register at the top level only
`src/main.tsx` calls `seal()` before it renders. A `registerModule()` call made later, for example inside an effect or after an `await`, throws "module … was registered after the application started". `registerPreferences()` and `registerNodeLink()` are not sealed, but they also belong at the top level so they are in place before the first page renders.
:::

### Calling the API

`resources/js/api.ts` keeps the module's requests typed and in one place:

```ts
import { api } from '@/api/request'

const base = (db: string) => `/api/databases/${encodeURIComponent(db)}/search`

export function searchObjects(db: string, criteria: { text: string; type: string; system: boolean }) {
  return api.post<{ results: ObjectResult[] }>(`${base(db)}/objects`, criteria).then((r) => r.results)
}
```

Import from other modules through their alias, for example `import SqlEditor from '@sql/js/editor/SqlEditor'` or `import { treeState } from '@/layout/tree/treeState'` for the shell.

## Migrations

A module that keeps its own data in the app's SQLite storage implements `ProvidesMigrations` and returns `database/migrations`. Each file returns a `PhpPgAdmin\Core\Storage\Migration`:

```php
// Modules/Example/database/migrations/2026_11_01_000001_create_example_notes_table.php
use PhpPgAdmin\Core\Storage\Migration;

return new class implements Migration {
    public function up(PDO $db): void
    {
        $db->exec(<<<'SQL'
            CREATE TABLE example_notes (
                id       INTEGER PRIMARY KEY AUTOINCREMENT,
                server   TEXT NOT NULL,   -- "host:port", Server::key()
                username TEXT NOT NULL,
                note     TEXT NOT NULL
            )
            SQL);
    }
};
```

Migrations run on the first `Storage::connection()` of a request, each in its own transaction, once each, sorted by file name across all modules. Name them `YYYY_MM_DD_NNNNNN_what_it_does.php` so a migration that depends on another module's table sorts after it. There is no `down()` and no rollback command. Key rows by `server` and `username` the way the existing tables do, so one role's data stays separate from another's.

## Checklist for a new module

1. Create `Modules/<Name>/<Name>Module.php` with `name()` equal to the lower-cased directory name and `path()` returning `__DIR__`.
2. Implement the contracts you need, and add `routes/api.php`, controllers, `resources/lang/en.json` (plus every other locale), `resources/sql/…` and `resources/js/app.tsx` as required.
3. Add the class to `bootstrap/modules.php` at the position where its routes and tabs belong.
4. Check that `php artisan laramod:vite` lists the module with its entries. With `pnpm dev` running, the dev server restarts and `tsconfig.app.json` gains the `@<name>` alias.
5. Run `pnpm typecheck` and `php -l` on the new PHP files, then load every tab at every level in the app, not only the new page.
