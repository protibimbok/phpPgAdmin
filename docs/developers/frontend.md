# Frontend

The browser side of phpPgAdmin is a React 19 single-page application written in TypeScript and built with Vite. The shell lives in `src/`. Every module adds its own pages from `Modules/<Name>/resources/js/`. This page covers the shell's structure and the shared pieces a module page uses: routing, the API layer, levels and tab bars, notifications, modals, preferences, styling, icons and the SQL editor.

## Structure of `src/`

```text
src/
  main.tsx            Entry: i18n, seal() of the module registry, <BrowserRouter>, <App>, theme.scss
  App.tsx             Asks /api/auth/me; shows the Auth module's login page or the layout
  modular.ts          registerModule(), getMenu(), getMenuFor(level), getRoutes(), insertAfter/Before
  slot.tsx            createSlot(): layout spots filled by modules through portals
  level.ts            parseLevel(), useLevel(), urls, fillPath()
  session.tsx         SessionContext, useSession(): the signed-in user and logout()
  preferences.ts      The preferences registry
  notify.ts           notify(), notifySuccess(), notifyError(), dismiss()
  unbuilt.ts          notAvailable()
  format.ts           formatSize(): bytes as B … TiB
  api/request.ts      request(), api.get/post/put/patch/delete, ApiError, errorMessage()
  api/useRequest.ts   useRequest(load, deps)
  nodes/client.ts     Node API: collectionUrl(), collection(), resolve(), getNodeTypes()
  nodes/links.ts      registerNodeLink(), registerContainerLink(), nodeLink()
  layout/             Layout, MenuBar (breadcrumb + tabs), Navigation (left panel), NavigationTree slot,
                      tree/ (tree items, controls, treeState), Notifications, UserMenu
  components/         Modal, PreviewSql, ConfirmQuery, SqlView, DependencyPanel, StatisticsPanel,
                      ObjectSection, Icon
  i18n/               i18next setup, LocaleSelect, useLocale()
  lang/               The "app" namespace messages (en.json, ar.json)
  pages/NotFound.tsx
  styles/             theme.scss, _tokens.scss, _variables.scss and the pmahomme partials
  img/                phpMyAdmin's icons (img/icons/*.png), jQuery UI images, logo
```

Module code imports the shell through `@/…` (`vite.config.ts` and `tsconfig.app.json`) and other modules through their `@<module>/…` alias, for example `@sql/js/editor/SqlEditor`.

## Startup and routing

1. The PHP shell writes `<html lang dir>`, the `app-config` JSON (locale and locales) and the script tags: every module's frontend script first, in PHP module order, then `src/main.tsx`.
2. Each module script runs `registerModule()` and any other registrations at its top level.
3. `main.tsx` imports `@/i18n`, calls `seal()` and renders `<BrowserRouter><Suspense><App/></Suspense></BrowserRouter>` in `StrictMode`.
4. `App` calls `me()`. While it waits it renders nothing. With no session it shows `Login` from `@auth/js/Pages/Login`. With a session it loads the role's preferences, then renders the routes.

The routes are React Router 7 route objects in library mode (`useRoutes`): one layout route whose children are every module's `routes` in module order, then `{ path: '*', element: <NotFound /> }`. Module route paths are relative (no leading `/`). `{ index: true }` is the server home page, registered by the Server module.

URL patterns, matched by `parseLevel()`:

```text
/                                         server
/server/<page>                            server-level pages (databases, sql, status, settings, …)
/db/:db[/<page>]                          database
/db/:db/schema/:schema[/<page>]           schema
/db/:db/schema/:schema/table/:table[/…]   table  (also view/:table, mview/:table)
```

Pages read the names with `useParams()` and turn them into OIDs with the node client's `resolve()` when they call node routes.

## Levels, breadcrumb and tab bars

`useLevel()` returns where the current URL is:

```ts
interface Level {
  name: 'server' | 'database' | 'schema' | 'table'
  db?: string
  schema?: string
  table?: string
  kind?: 'table' | 'view' | 'mview'
}
```

`MenuBar` uses it for two things:

- **Breadcrumb**: **Server:** host:port » **Database:** db » **Schema:** s » **Table:** t (or **View:**, **Materialized view:**), each a link built with `urls.server()`, `urls.database(db)`, `urls.schema(db, s)` and `urls.relation(db, s, name, kind)`.
- **Tab bar**: `getMenuFor(level)` keeps the tabs whose `level` matches (server when unset) and whose `kinds` include the relation's kind, then fills `:db`, `:schema`, `:kind` and `:table` in their paths. The active tab is the deepest tab path that is a prefix of the current path, so `/db/x/schema/s/sequences/create` lights up **Sequences** and not the schema's first tab.

A module adds tabs with `menuFilter`. The filters run in registration order, each receiving the list the previous ones built, for every level at once:

```ts
registerModule({
  id: 'sequences',
  order: 31,
  menuFilter: (menu) => [...menu, { label: 'sequences:tab', icon: 'b_events', path: '/db/:db/schema/:schema/sequences', level: 'schema' }],
  routes: [ /* … */ ],
})
```

Tab labels are `namespace:key` i18n keys. `MenuBar` loads every namespace the menu names, so the namespaces are fetched before the bar renders.

### Slots and fills

`createSlot(name)` returns `{ Provider, Outlet, Fill }`. The layout renders the `Outlet` where content belongs, and anything inside a `<Fill>` is portalled there. The navigation tree is the one slot today:

```tsx
// Modules/Databases/resources/js/app.tsx
registerModule({
  id: 'databases',
  // …
  fills: (
    <NavigationTree.Fill>
      <DatabaseTree />
    </NavigationTree.Fill>
  ),
})
```

The layout renders every registration's `fills` for the whole session, inside the slot providers, so a module can fill a spot that none of its pages own. The SQL module uses `fills` to keep the console mounted.

The tree's open state lives in `treeState` (`src/layout/tree/treeState.ts`), kept in `sessionStorage` per server and user. After a page creates, renames or drops an object, call `treeState.refresh()` so the tree reloads.

## API calls

`src/api/request.ts` is a small `fetch` wrapper:

```ts
import { api, errorMessage, ApiError } from '@/api/request'

const rows = await api.get<{ rows: Row[] }>(`/api/databases/${encodeURIComponent(db)}/…`)
await api.post('/api/…', { name })          // body sent as JSON
```

- It sends cookies (`credentials: 'same-origin'`), `Accept: application/json`, and `Content-Type: application/json` when there is a body.
- A non-2xx response throws `ApiError` with `status`, `message` (the body's `message`, else `reason_phrase`), `sqlstate`, `detail`, `hint`, `position` and `remedy`.
- A 204 resolves to `undefined`.
- `errorMessage(e)` gives a displayable string for any thrown value.

Encode database and object names with `encodeURIComponent` when you build URLs. The PHP side decodes `{db}` with `rawurldecode`.

::: warning No global handling of an expired session
`ApiError.unauthorized` is `true` for a 401, but nothing acts on it. When the PHP session expires, calls fail with "Unauthorized" in the page's error box or a notification, and the login page only comes back on the next full page load. Handle `unauthorized` in a page if it matters there.
:::

`useRequest(load, deps)` loads data in a component:

```tsx
const { data, error, loading, reload } = useRequest(async () => {
  const scid = await resolveSchema(db, schema)
  return { scid, rows: await sequences(db, scid).list() }
}, [db, schema])
```

It runs on mount and whenever `deps` change, keeps the previous `data` while reloading, and drops answers that arrive after a newer call started, so switching pages quickly never shows a stale result. `reload()` runs the call again.

The node API client (`collection()`, `resolve()`, `collectionUrl()`) is described in [SQL templates and nodes](/developers/nodes#frontend).

## Notifications

`notify(message, type?, timeout?)` shows phpMyAdmin's floating message at the top of the page content. `type` is `notice` (the default; a plain yellow note), `success`, `warning` or `error`. One message shows at a time, and a new one replaces it. Errors stay until clicked, and other types disappear after 5 seconds unless you pass a `timeout` (or `null` to keep the message).

```ts
import { notify, notifyError, notifySuccess } from '@/notify'

notifySuccess(t('editor.created', { name }))
notifyError(errorMessage(e))
```

The `Notifications` component that shows them is part of the layout, so any code, including code outside React, can call `notify()`.

## Modal, PreviewSql and ConfirmQuery

`Modal` is a Bootstrap 5 modal driven by React state, not by Bootstrap's script:

```tsx
<Modal show={open} title={t('drop')} onClose={() => setOpen(false)} size="lg" footer={<>…</>}>
  …
</Modal>
```

It portals to `document.body`. Escape and a click on the backdrop call `onClose`. Modals stack, and Escape closes only the top one. The default footer is a single **Close** button.

`PreviewSql` is phpMyAdmin's **Preview SQL** dialog on top of `Modal`. Pass `sql={null}` while the statement is being fetched, and `error` if fetching failed. With `onConfirm` it adds an **OK** button, which makes it a confirmation dialog:

```tsx
function showPreview() {
  setPreview({ sql: null, error: null })
  sequenceModifiedSql(db, scid, payload(), editing ? seid : undefined).then(
    (sql) => setPreview({ sql, error: null }),
    (err: unknown) => setPreview({ sql: null, error: errorMessage(err) }),
  )
}

<PreviewSql show={preview !== null} sql={preview?.sql ?? null} error={preview?.error} onClose={() => setPreview(null)} />
```

The SQL comes from the node's `msql` route, so it is exactly what saving the form would run (see [the Preview SQL convention](/developers/nodes#the-preview-sql-convention)).

`ConfirmQuery` is phpMyAdmin's "Do you really want to execute …?" dialog, with the statement(s), an optional warning or extra content, and OK and Cancel. The SQL module's `isDestructive(sql)` decides whether a statement needs it (DROP, DELETE, TRUNCATE, `ALTER … DROP`, UPDATE without WHERE). The `features.confirm` preference turns the confirmation off.

Other shared components:

| Component | Use |
|---|---|
| `SqlView` | Read-only statements in a `<pre>` with a copy link, for "Show create"-style output |
| `DependencyPanel` | Dependencies and Dependents cards from the node API, types labelled from `app:dependency.types.*` |
| `StatisticsPanel` | A Statistics card from a `stats` route; sizes in units, timestamps localised |
| `ObjectSection` | A list of schema objects (heading, check-all, Export/Drop, create button, one row per object) used for triggers, rules, policies, collations and text search objects |
| `Icon` | One of phpMyAdmin's 16px icons |

## Unbuilt controls: `notAvailable()`

phpMyAdmin never shows a disabled form, so neither does phpPgAdmin. A control whose feature is not built yet is rendered as a live control and answers with a notice:

```tsx
import { notAvailable } from '@/unbuilt'

<a href="#chart" className="btn" onClick={notAvailable}>{t('display_chart')}</a>
<form onSubmit={notAvailable}>…</form>
```

`notAvailable(event)` calls `preventDefault()` and shows **Not available yet.** (`app:not_available_yet`) as a notice. Do not add `disabled` to controls for unbuilt features. Use `notAvailable`, so the gap is easy to find with a search for `notAvailable(` and the UI matches phpMyAdmin's.

## Preferences

`src/preferences.ts` is a registry of settings after phpMyAdmin's user preferences. A module declares the settings it reads, and the Settings module renders them on the server's **Settings** tab. The values are stored per role and server by the Auth module (`GET/PATCH /api/preferences`, SQLite `preferences` table).

```ts
// Modules/Sql/resources/js/preferences.ts, imported by the module's app.tsx
import { registerPreferenceGroups, registerPreferences } from '@/preferences'

export const MAX_ROWS = 'main.max_rows'

registerPreferenceGroups([
  { page: 'main-panel', id: 'browse', label: 'settings:groups.browse', description: 'settings:groups.browse_help' },
])

registerPreferences([
  { key: MAX_ROWS, type: 'number', default: 25, min: 1, page: 'main-panel', group: 'browse',
    label: 'settings:main.max_rows', description: 'settings:main.max_rows_help' },
])
```

| Field | Meaning |
|---|---|
| `key` | Stored key, `area.name` |
| `type` | `boolean`, `number`, `select` (with `options: [{ value, label }]`) or `text` |
| `default` | Used when the role has stored nothing, or a value of the wrong type |
| `page`, `group` | Where it shows: page `features`, `sql`, `navigation`, `main-panel`, `export` or `import`; group is a registered `PreferenceGroup` on that page |
| `label`, `description` | i18n keys |
| `min`, `max` | Bounds for numbers |

Read a value with `usePreference<number>(MAX_ROWS)` in a component (it re-renders on change), or `preference(key)` outside React. `savePreferences({ key: value })` stores values. A value equal to its default, or `null`, deletes the stored row, so a later change of the default reaches every role that never changed it.

::: info Settings pages are a fixed list
The Settings page shows the pages in its own `PAGES` list (`features`, `sql`, `navigation`, `main-panel`, `export`, `import`, plus **Manage your settings**). A preference with any other `page` is stored and read normally but never shown. A group appears only when at least one preference is registered in it. The existing labels live in the Settings module's message files (`settings:…`), not in the module that owns the setting.
:::

The preferences are loaded once, after sign-in and before the first page renders, so `preference()` is synchronous everywhere in the app.

## Styling

The theme reproduces phpMyAdmin's **pmahomme** theme on Bootstrap 5.3 and is assembled the way a phpMyAdmin theme is. `src/styles/theme.scss`:

```scss
@import 'tokens';      // design tokens: colours, fonts, spacing, radii, shadows, breakpoints, sizes
@import 'variables';   // Bootstrap variables derived from the tokens, mirroring pmahomme's _variables.scss
@import 'bootstrap/scss/bootstrap';
@import 'root';        // the tokens as --pga-* custom properties
@import 'base';
@import 'layout';
// … navigation, icons, forms, buttons, navbar, nav, card, breadcrumb, alert, tables, modal, …
```

Rules for changing styles:

1. **Tokens first.** Colours, sizes and spacing are declared once in `_tokens.scss` and read with `color('link')`, `space(3)`, `font-size('base')`, `radius('base')`, `size('icon')` and so on. The file emits no CSS and does not depend on Bootstrap.
2. **Bootstrap variables over rules.** `_variables.scss` maps tokens onto Bootstrap's variables, variable for variable with pmahomme's `_variables.scss`, so the two files can be diffed. Prefer changing a variable to overriding a rule.
3. **Hand-written partials only where phpMyAdmin has them.** The `_*.scss` partials mirror pmahomme's own partials (navigation, tables, results, console, designer…).
4. **Module stylesheets** import the tokens with `@use '@/styles/tokens' as *;` and are imported from TypeScript. `Modules/Auth/resources/scss/login.scss` is the example.
5. At runtime the tokens are also available as CSS custom properties, `var(--pga-color-link)`, `var(--pga-space-3)`, `var(--pga-radius-sm)`.

Bootstrap still uses `@import`, so the partials are loaded the same way to share its scope. `vite.config.ts` silences Sass's `import` deprecation and dependency warnings.

### Right-to-left

`postcss-rtlcss` (configured in `vite.config.ts`) flips the whole stylesheet the way phpMyAdmin uses rtlcss. The flipped rules sit next to the originals under a `[dir="rtl"]` prefix. The PHP shell sets `<html dir>` from the locale, and the client changes it when the locale changes, so there is no second stylesheet. With `safeBothPrefix: true`, declarations that are the same in both directions get a `[dir]` prefix too, so the extra specificity of the flipped rules does not reorder the cascade.

Write styles with physical properties (`margin-left`) and let the plugin flip them, or with logical properties (`margin-inline-start`), which need no flipping. Mark content that must stay left-to-right in any locale, such as SQL, identifiers and code, with `dir="ltr"`. `PreviewSql` and `SqlView` already do.

## Icons

`<Icon name="b_search" title="Search" />` renders a `<span class="icon ic_b_search">` with the PNG as its background, 16px square like phpMyAdmin's `<img>` icons. Without `title` it is `aria-hidden`; with one it gets `role="img"`, `aria-label` and a tooltip.

The images are phpMyAdmin's (pmahomme) in `src/img/icons/`. A class exists only for names listed in the `$icons` map in `src/styles/_icons.scss`:

```scss
$icons: (
  'b_bookmark',
  'b_browse',
  // …
);
```

::: warning A new icon needs two steps
Copy the PNG into `src/img/icons/` and add its name to `$icons`. A name that is only in the folder renders an empty 16px box, with no build error. The same applies to `icon` in tab definitions and node definitions.
:::

## SQL editor (CodeMirror)

The SQL box is CodeMirror 6, wrapped in `Modules/Sql/resources/js/editor/SqlEditor.tsx` and used by the SQL page, the console, and the view, routine and rule editors:

```tsx
import SqlEditor, { type SqlEditorHandle } from '@sql/js/editor/SqlEditor'

<SqlEditor value={sql} onChange={setSql} onSubmit={run} schema={completions} defaultSchema="public" />
```

| Prop | |
|---|---|
| `value`, `onChange` | Controlled text; an outside change of `value` is written into the editor |
| `onSubmit` | Ctrl+Enter / Cmd+Enter |
| `enterSubmits` | Enter runs and Shift+Enter inserts a line (the console's option) |
| `schema`, `defaultSchema` | `SQLNamespace` for table and column completion; the default schema's tables also complete by bare name |
| `lineNumbers` | Gutter, on by default |
| `placeholder`, `autoFocus`, `id`, `ariaLabel`, `className` | |

Extensions: `@codemirror/lang-sql` with the `PostgreSQL` dialect and upper-case keyword completion, line numbers, history, bracket matching and closing, active-line highlight, line wrapping, the default highlight style, and the default, history, completion and indent-with-Tab keymaps. A ref exposes `insert(text)` and `focus()`. Changing the completion schema reconfigures the language through a `Compartment`, without recreating the editor.

`HighlightedSql.tsx` highlights read-only SQL with the same parser (lezer `tok-*` classes coloured in `_results.scss`). `sql-formatter` (`language: 'postgresql'`, upper-case keywords) backs the SQL page's **Format** button and the view editor.
