# SQL templates and nodes

Most of phpPgAdmin's object pages (schemas, tables, sequences, functions, types, extensions and so on) run on a port of pgAdmin 4's object model. A **node type** declares an object kind and its parent. The registry generates a REST API for it, a controller fills in the operations, and the SQL comes from Twig templates copied from pgAdmin, one version folder per PostgreSQL release. This page explains each part and then walks through the Sequences module, which is small enough to read in full.

The code is in `app/Core/Nodes/` and `app/Core/Sql/`. Node types are registered by modules that implement `ProvidesNodes` and `ProvidesSqlTemplates` (see [Writing a module](/developers/modules)).

## Node definitions

A module returns its node types from `nodes()`:

```php
// Modules/Sequences/SequencesModule.php
public function nodes(): array
{
    return [
        new NodeDefinition(
            type: 'sequence',
            collection: 'sequences',
            idParam: 'seid',
            controller: SequenceController::class,
            parent: 'schema',
            templateDir: 'sequences',
            label: 'Sequences',
            icon: 'b_events',
            supports: ['sql', 'msql', 'stats', 'depends', 'resolve'],
        ),
    ];
}
```

| Parameter | Meaning |
|---|---|
| `type` | The node type, used by the tree, the link registry and `resolve` (`sequence`). Lower case, `[a-z][a-z0-9_]*`; must be unique across modules. |
| `collection` | The plural URL segment (`sequences`). Hyphens are allowed. |
| `idParam` | The route parameter holding the object's OID, named as pgAdmin's templates name it (`seid`, `tid`, `scid`). Templates receive it as a variable. |
| `controller` | A subclass of `NodeController`. |
| `parent` | Another node type, or `NodeDefinition::DATABASE` (directly in a database: schemas, extensions, casts), or `NodeDefinition::SERVER` (databases, roles, tablespaces). The default is `DATABASE`. |
| `templateDir` | The template folder; defaults to `collection`. |
| `label`, `icon` | Folder label and icon for the tree. |
| `minVersion`, `maxVersion` | The server versions the type exists on (default `130000`, no maximum). On other servers its routes answer 404 "This server (version …) has no … objects" and it is left out of `nodes` and `children`. |
| `supports` | Optional operations: `sql`, `msql`, `stats`, `depends`, `children`, `resolve`. `list`, `nodes`, `node`, `properties`, `create`, `update` and `delete` always have routes. |
| `collectionNode` | Whether the tree shows a folder ("Sequences") holding the nodes. |
| `extension` | An extension the objects belong to (`pg_cron`): the type is listed (`GET …/nodes`) and its routes answer only in a database that has it installed; elsewhere they are 404. |

The constructor validates the names, the parent and the controller class, so a typo fails at boot. `NodeRegistry::register()` rejects a type registered twice, and `ancestors()` rejects a cyclic parent chain.

44 node types are registered today, from `database`, `role` and `tablespace` at the server level down to `user_mapping` under `foreign_server`. `GET /api/server/nodes` and `GET /api/databases/{db}/nodes` list the ones the connected server has.

::: info Collection names are not uniform
Some collections use hyphens (`primary-keys`, `trigger-functions`, `unique-constraints`) and others underscores (`fts_configurations`, `foreign_data_wrappers`, `event_triggers`). Use the client's `collectionUrl()` with the exact `collection` value rather than deriving it from the type.
:::

## Generated routes

`NodeRegistry::registerRoutes()` walks each type's parent chain and builds its path. A server-level type hangs under `/api/server`. Every other type hangs under `/api/databases/{db}`, with each ancestor contributing `<collection>/{<idParam>:number}`. For a sequence (`schema` → `sequence`):

| Method and path (under `/api/databases/{db}/schemas/{scid}/sequences`) | Operation | Controller method | Response |
|---|---|---|---|
| `GET` | list | `list()` | `{rows}` |
| `GET /nodes` | nodes | `nodes()` | `{nodes: [{id, oid, label, type, icon, inode, meta}]}` |
| `POST` | create | `create()` | 201 `{node}` |
| `GET /{seid}` | properties | `properties()` | `{properties}` |
| `GET /{seid}/node` | node | `node()` | `{node}` |
| `PUT /{seid}` | update | `update()` | `{node}` |
| `DELETE /{seid}[?cascade=1]` | delete | `delete()` | `{ok: true}` |
| `POST /msql`, `POST /{seid}/msql` | msql (`supports: msql`) | `modifiedSql()` | `{sql}` |
| `GET /{seid}/sql` | sql (`supports: sql`) | `sql()` | `{sql}` |
| `GET /stats`, `GET /{seid}/stats` | stats (`supports: stats`) | `statistics()` | `{columns, rows}` |
| `GET /{seid}/dependencies`, `GET /{seid}/dependents` | depends (`supports: depends`) | `dependencies()`, `dependents()` | `{dependencies}`, `{dependents}` |
| `GET /{seid}/children` | children (`supports: children`) | `children()` | `{children: [node types]}` |

Two more routes exist for each root (`/api/server` and `/api/databases/{db}`):

- `GET …/nodes`: the node types available on this server at that level.
- `GET …/resolve?type=<type>&<params>`: the OIDs behind a name, for types with `supports: resolve`. For example, `resolve?type=sequence&schema=public&name=invoice_number` returns `{"ids":{"scid":2200,"seid":17617}}`.

The OID parameters match digits only (`{seid:number}`), so the static segments `nodes`, `msql` and `stats` never collide with an object. The routes are in the `nodes` group of `config/modules.php`, which includes `Authenticate`, so a node controller always has a connection pool.

pgAdmin calls these operations `obj`, `nodes`, `sql`, `msql`, `stats`, `dependency` and `dependent`. Here they are REST verbs on the collection and item, and the last two are spelled `dependencies` and `dependents`.

::: warning `resolve` is opt-in, and not every type can resolve
`resolve` answers 400 "Objects of type "function" cannot be looked up by name" for a type without `supports: resolve`. Functions, procedures, operators and aggregates are not resolvable because their names are overloaded; their pages carry the OID instead. Asking for a server-level type under `/databases/{db}` (or the reverse) is also a 400. An unknown name is a 404.
:::

## Dispatch and context

Every generated route calls `NodeDispatcher::handle($registry, $node, $operation, $request, $args)`, which:

1. Takes a connection from the request's `ConnectionPool`: the maintenance database for server-level types, otherwise the database named in the URL (URL-decoded).
2. Collects the OIDs of the node and its ancestors from the route into `ids` (`['scid' => 2200, 'seid' => 17617]`).
3. Checks `availableOn($version)`.
4. Creates the controller with `new`, calls the method and wraps the result in the response shape above.

The controller gets a `NodeContext`:

| Member | What it gives |
|---|---|
| `$ctx->conn`, `$ctx->database`, `$ctx->pool`, `$ctx->request`, `$ctx->node`, `$ctx->registry` | The connection, database name, pool, PSR-7 request, the type's definition and the registry |
| `$ctx->version()` | `server_version_num`, e.g. `180006` |
| `$ctx->id('scid')` | An OID from the route, or null |
| `$ctx->did()` | The current database's OID, which pgAdmin's templates read as `did` (queried once per context) |
| `$ctx->render($file, $vars)` | Renders one of the node's templates for this server version, with `conn`, the route OIDs and (inside a database) `did` added to `$vars` |
| `$ctx->renderFrom($dir, $file, $vars)` | The same from another node's folder, e.g. `renderFrom('triggers', 'nodes.sql', …)` |
| `$ctx->rows()`, `row()`, `query()` | Render a template and run it |
| `$ctx->has($file)` | Whether the template exists for this version |
| `$ctx->input()`, `queryParams()`, `flag('cascade')` | The JSON body; query parameters; a boolean query flag (`''`, `0` and `false` are false) |

## Node controllers

`NodeController` has a default for each operation:

| Method | Default |
|---|---|
| `list($ctx)` | `properties.sql` rows |
| `nodes($ctx)`, `node($ctx, $oid)` | `nodes.sql` rows (with `<idParam>` set for one node) shaped by `toNode()`: `id` = `<type>_<oid>`, `label` = `name`, `icon` from `icon()`, `inode` = whether the type has child types, `meta` = the rest of the row |
| `properties($ctx, $oid)` | One `properties.sql` row, or 410 Gone ("It may have been removed by another user") |
| `statistics($ctx, $oid)` | `coll_stats.sql` (no OID) or `stats.sql`, with column names and types |
| `dependencies()`, `dependents()` | `Dependencies::of()` / `dependents()`; `?system_objects=1` includes system objects |
| `children()` | The child node types from the registry |
| `create`, `update`, `delete`, `sql`, `modifiedSql`, `resolve` | 405 "The … node does not support …" |

Protected helpers for subclasses: `execute($ctx, $sql)` runs rendered SQL with `queryMulti()` and skips it when only whitespace and `--` comments remain (which is what pgAdmin's templates render when nothing changed). `requireName($data)` gives pgAdmin's "Could not find the required parameter (name)." `incomplete()`, `gone()`, `notFound()` and `notSupported()` build the matching HTTP exceptions.

`RelationController` extends it for objects in `pg_class` (tables, views, materialized views, sequences). It passes `datlastsysoid` to the templates and implements `resolve()` by schema and name for the `relkinds()` the subclass returns.

### Core helpers

| Class | Role |
|---|---|
| `Acl` | Converts privileges between the catalog, the client and the templates (pgAdmin's `parse_priv_from_db` / `parse_priv_to_db`). `fromDb($row)` gives `{grantor, grantee, privileges: [{privilege_type, privilege, with_grant}]}`. `toDb($entries, $allowed)` gives the template rows `{grantee, with_grant: [...], without_grant: [...]}` with codes spelled out, `ALL` collapsed and `PUBLIC` unquoted. `Acl::PRIVILEGES` maps the codes (`r` → `SELECT`, `U` → `USAGE`, `m` → `MAINTAIN`…). Pass the codes the object accepts as `$allowed` (`['r', 'w', 'U']` for a sequence). |
| `Dependencies` | Renders `depends/default/{dependencies,dependents}.sql` from the core templates and maps `pg_depend` rows to `{type, name, field, icon}` with pgAdmin's type tables, so the frontend's `DependencyPanel` can label them. |
| `Ddl` | `Ddl::header('Table', 'public.t', $dropSql)` writes pgAdmin's SQL-tab header (`-- Table: public.t` and the DROP statement commented out). `Ddl::assemble([...parts])` joins the parts with blank lines, drops empty ones and tidies the result. |
| `Catalog` | Lists for editors: roles, tablespaces, encodings, schemas, collations, databases. |
| `Options` | Parses pgAdmin-style variable rows, security labels and PostgreSQL array strings. |
| `VacuumSettings` | The autovacuum and toast reloptions grid of tables and materialized views. |

## SQL templates

Templates are pgAdmin's Jinja files converted to Twig, keeping pgAdmin's names (`properties.sql`, `nodes.sql`, `create.sql`, `update.sql`, `delete.sql`, `acl.sql`, `stats.sql`, `coll_stats.sql`…), with no `.twig` suffix.

```text
Modules/Sequences/resources/sql/
  sequences/
    default/   acl.sql backend_support.sql coll_stats.sql count.sql create.sql delete.sql
               get_def.sql get_dependencies.sql get_oid.sql grant.sql nodes.sql
               properties.sql stats.sql update.sql
    15_plus/   create.sql properties.sql update.sql
```

### How a version is picked

`Sql::render('sequences', 'create.sql', $vars, 180006)` asks the Twig environment for the template `sequences/create.sql#180006`. `VersionedLoader` walks the version folders from newest to oldest:

```text
18_plus (180000) → 17_plus → 16_plus → 15_plus → 14_plus → 13_plus → 12_plus → 11_plus → default (0)
```

It skips folders whose minimum is above the server version, and returns the first `<root>/sequences/<folder>/create.sql` that exists. Each file is resolved on its own, so overrides are file by file. On PostgreSQL 18, `create.sql`, `properties.sql` and `update.sql` come from `15_plus` and everything else from `default`. A newer folder only needs the files that changed in that release.

All of pgAdmin's folder names are known, so a `12_plus` folder copies across as it is, even though phpPgAdmin supports PostgreSQL 13 and up. The modules currently use `default`, `12_plus`, `14_plus`, `15_plus`, `16_plus` and `17_plus`.

### Roots and overriding

The loader searches roots in this order: the core root `app/Core/Sql/templates/`, then each `ProvidesSqlTemplates` module's directory, in module order. Within each version folder, the first root holding the file wins. So:

- A module cannot override a core template or a template of a module wired before it, for the same folder and version. Give your folder a name of its own.
- A newer version folder in a later root still beats an older one in an earlier root, because the version walk is the outer loop.

Names without `#version` are looked up as plain paths across the same roots. That is how macro imports resolve:

```twig
{% import 'macros/schemas/privilege.macros' as PRIVILEGE %}
{% import 'columns/macros/security.macros' as COLUMN_SECLABEL %}
```

The core root holds pgAdmin's shared files under the names its templates import them by: `macros/privilege.macros`, `macros/security.macros`, `macros/variable.macros`, `macros/default_privilege.macros`, `macros/catalogs.sql`, `macros/schemas/*.macros`, `macros/functions/*.macros`, `types/macros/get_full_type_sql_format.macros`, `depends/default/*.sql` and `vacuum_settings/`. Module-specific macro folders live beside the node folders (`Modules/Tables/resources/sql/tables/macros/`, `…/columns/macros/`).

`..` is refused in template names. A missing template throws a Twig `LoaderError` naming the folder, the version and the roots searched.

### The environment

`SqlTemplates` creates Twig with `autoescape: false` (the output is SQL, not HTML), `strict_variables: false` (an unknown variable is empty, like Jinja's `Undefined`), `auto_reload: true` and a cache at `<storage dir>/cache/twig`. After rendering, trailing spaces are stripped, three or more newlines become two, and the result is trimmed. `Sql::renderPlain($name, $vars)` renders by plain name, and `Sql::has($dir, $file, $version)` tests for a file.

### Twig helpers

`TwigExtension` provides what pgAdmin's templates use from Jinja and its driver:

| Helper | Use | Notes |
|---|---|---|
| `qtIdent` filter | <code v-pre>{{ conn&#124;qtIdent(data.schema, data.name) }}</code> | Quotes and joins with `.`. The filtered value (`conn`) is ignored, as in pgAdmin. A single list argument quotes each entry and returns a list. |
| `qtTypeIdent` filter | <code v-pre>{{ conn&#124;qtTypeIdent(data.typname) }}</code> | Type names: `character varying`, column-name keywords and `[]` stay unquoted |
| `qtLiteral` filter | <code v-pre>{{ data.comment&#124;qtLiteral(conn) }}</code> | With a `Connection` and a string, `pg_escape_literal`; otherwise `Quoting::literal()`. A third argument `true` forces quotes around numbers. |
| `string`, `int` filters | <code v-pre>{{ data.cache&#124;int(-1) }}</code> | Python's `str()` (`True`/`False`/`None`) and `int(value, default)` |
| `lower` filter | <code v-pre>{{ data.security_barrier&#124;lower }}</code> | Booleans become `true`/`false`, as Python's `str()` does |
| `rstrip`, `tojson`, `list`, `unique`, `hasAny` | | `list` turns a PostgreSQL array string into a list; `hasAny(keys)` tests a dict for any of the keys |
| `namespace()` function | `{% set ns = namespace({a: false}) %}{% do ns.set('a', true) %}` | Jinja's mutable namespace |
| `range()` function | `range(3)` gives 0, 1, 2 | Jinja's one-argument form; two or three arguments are Twig's inclusive range |
| `_()` function | <code v-pre>{{ _('Sequence name') }}</code> | pgAdmin's gettext; returns the text unchanged |
| `none`, `number` tests | `x is none` | |

### Porting a template from pgAdmin

`tools/port-pgadmin-templates.py` copies one node's folder from a pgAdmin checkout and applies the mechanical Jinja-to-Twig rules (`elif` → `elseif`, `True/False/None`, `is none`, `'key' in data` → `data.key is defined`, `x if c else y`, Python string methods…). It flattens `pg/` variants, skips `ppas/` and lists what it could not translate:

```bash
tools/port-pgadmin-templates.py \
  ../pgadmin4/web/pgadmin/browser/server_groups/servers/databases/schemas/sequences/templates/sequences/sql \
  Modules/Sequences/resources/sql/sequences --dry-run
```

Check these by hand after porting:

- **Truthiness.** In PHP the string `'0'` is false, and Twig's `==` is PHP's loose comparison (`'on' == true`). Compare with `is same as(true)` where pgAdmin wrote `== True`. The tool already does this.
- **Dict membership.** Twig's `in` tests values, not keys: `'name' in data` must become `data.name is defined`.
- **Tuples.** `x in ('a', 'b')` becomes `x in ['a', 'b']`. SQL's own `IN ('a', 'b')` outside the tags must stay as it is.
- **No unpacking.** `for a, b in pairs` becomes `for pair in pairs` with `pair[0]`.
- **Whitespace.** Twig drops the first newline after a block tag and Jinja keeps it. The post-render tidy step absorbs most of the difference; compare the output against pgAdmin's for blank lines inside statements.
- **Placeholders.** psycopg's `%(x)s` placeholders and `|replace("%", "%%")` disappear: bind values with `$n` parameters or quote them with `qtLiteral`.

## The Preview SQL convention

Every editor that changes an object offers phpMyAdmin's **Preview SQL** button, backed by the `msql` operation. The rule is that `modifiedSql()` renders exactly what `create()` or `update()` would run, from the same data, without running it:

- `POST …/sequences/msql` with the create form's data → the `CREATE` and the grants that would follow it.
- `POST …/sequences/{seid}/msql` with the edit form's data → only the `ALTER` statements for what differs from the object as it stands. It renders an empty string when nothing changed.

Both are `POST`, also for edits, because they carry a body. A `PUT` to `…/msql` is a 405. To keep the preview and the real change in step, build the SQL in one private method and call it from both. `SequenceController::updateSql()` is used by `update()` and by `modifiedSql()`.

On the frontend, the form calls `collection(url).modifiedSql(data, oid)` and shows the result in `PreviewSql` (see [Frontend](/developers/frontend#modal-previewsql-and-confirmquery)).

## The link registry

Pages keep name-based URLs (`/db/bookshop/schema/public/sequences/invoice_number/edit`), and the API is addressed by OID. A frontend link registry, `src/nodes/links.ts`, connects tree nodes to pages:

```ts
// Modules/Sequences/resources/js/app.tsx
registerNodeLink('sequence', (node, { db, ancestors }) => {
  const schema = ancestors.find((a) => a.type === 'schema')
  return db === null || !schema ? '#' : `${urls.schema(db, schema.label)}/sequences/${encodeURIComponent(node.label)}/edit`
})

registerContainerLink('sequence', ({ db, ancestors }) => {
  const schema = schemaOf(ancestors)
  return db === null || schema === undefined ? '#' : `${urls.schema(db, schema)}/sequences`
})
```

`nodeLink(node, context)` returns the node type's own page, or its container's page, or, failing both, the page of the node it hangs under. The navigation tree uses it, and so do the dependency lists and the database **Search** tab. The search results come back with pgAdmin's object path (`:schema.2200:/public/:sequence.17617:/invoice_number`), which the Search page turns into tree nodes and passes to `nodeLink`. Registering links for a new node type therefore makes its objects clickable in search results and in the tree without further work. `schemaOf(ancestors)` and `relationOf(ancestors)` read the schema and the owning relation from the ancestors.

## Worked example: sequences

The Sequences module is one node type plus an extra options route.

### Backend

`Modules/Sequences/Http/Controllers/SequenceController.php` extends `RelationController` with `relkinds(): ['S']`. Each method does the following:

| Method | What it does |
|---|---|
| `list()` | `parent::list()` (`properties.sql` for the schema), each row merged with `get_def.sql` (the `pg_sequence` values: current value, min, max, increment, start, cache, cycle) |
| `properties()` | The same for one sequence, plus its security labels (`Options::parseSecurityLabels`) and privileges (`acl.sql` → `Acl::fromDb`) |
| `sql()` | `-- SEQUENCE: s.n` header with the commented `DROP SEQUENCE IF EXISTS`, then `create.sql` with `add_not_exists_clause: true`, then `grant.sql`, joined by `Ddl::assemble` |
| `create()` | `forCreate()` normalises the data (route schema, blank numbers dropped, `Acl::toDb($relacl, ['r','w','U'])`); runs `create.sql`, then `grant.sql` separately; finds the new OID with `get_oid.sql` and returns its node |
| `update()` | Runs `updateSql()`: compares the data with the current properties, drops unchanged keys, adds a `RESTART` when new bounds would leave the current value outside them, renders `update.sql` with `data` and `o_data` |
| `modifiedSql()` | `forCreate()` + `create.sql` + `grant.sql` for a new sequence, `updateSql()` for an existing one |
| `delete()` | `delete.sql` with `cascade` |
| `statistics()` | `coll_stats.sql` for the schema or `stats.sql` for one sequence (`pg_statio_all_sequences`) |
| `options()` | Not a node operation: roles, schemas and the schema's tables with their columns, for the editor's **Owned by** fields |

`options()` is exposed by a hand-written route in `routes/api.php`. It builds its own `NodeContext`, because only generated routes get one from the dispatcher:

```php
Route::middleware(Authenticate::class)->group(function (): void {
    Route::get('/databases/{db}/schemas/{scid:number}/sequences/options', function (ServerRequestInterface $request, array $args): array {
        $db = rawurldecode($args['db']);
        $pool = ConnectionPool::from($request);
        $ctx = new NodeContext(Nodes::get('sequence'), Nodes::registry(), $pool, $pool->for($db), $db, ['scid' => (int) $args['scid']], $request);

        return (new SequenceController())->options($ctx);
    });
});
```

Because `NodeRegistry` registers its routes after the module routes, and `options` is not a number, this path never collides with `…/sequences/{seid}`.

### Templates

`default/create.sql` and `15_plus/create.sql` differ in one line. PostgreSQL 15 added unlogged sequences, so the newer file adds the `UNLOGGED` keyword:

```twig
CREATE {% if data.relpersistence %}UNLOGGED {% endif %}SEQUENCE{% if add_not_exists_clause %} IF NOT EXISTS{% endif %} {{ conn|qtIdent(data.schema, data.name) }}{% if data.cycled %}

    CYCLE{% endif %}{% if data.increment is defined %}

    INCREMENT {{data.increment|int}}{% endif %}{% if data.start is defined %}

    START {{data.start|int}}{% endif %} …;
```

`grant.sql` imports the shared macros from the core root:

```twig
{% import 'macros/schemas/security.macros' as SECLABEL %}
{% import 'macros/schemas/privilege.macros' as PRIVILEGE %}
{% set seqname=conn|qtIdent(data.schema, data.name) %}
{% if data.comment %}

COMMENT ON SEQUENCE {{ seqname }}
    IS {{ data.comment|qtLiteral(conn) }};
{% endif %}
{% for priv in data.relacl %}
{{ PRIVILEGE.SET(conn, 'SEQUENCE', priv.grantee, data.name, priv.without_grant, priv.with_grant, data.schema) }}
{% endfor %}
```

### What the API returns

Against the demo database:

```text
GET /api/databases/bookshop/resolve?type=sequence&schema=public&name=invoice_number
{"ids":{"scid":2200,"seid":17617}}

GET /api/databases/bookshop/schemas/2200/sequences/17617/sql
-- SEQUENCE: public.invoice_number

-- DROP SEQUENCE IF EXISTS public.invoice_number;

CREATE SEQUENCE IF NOT EXISTS public.invoice_number
    INCREMENT 1
    START 1000
    MINVALUE 1
    MAXVALUE 9223372036854775807
    CACHE 1;

ALTER SEQUENCE public.invoice_number
    OWNER TO postgres;

POST /api/databases/bookshop/schemas/2200/sequences/msql   {"name":"demo_seq","increment":"5","comment":"x"}
CREATE SEQUENCE public.demo_seq
    INCREMENT 5;

COMMENT ON SEQUENCE public.demo_seq
    IS 'x';

POST /api/databases/bookshop/schemas/2200/sequences/17617/msql   {"increment":"2"}
ALTER SEQUENCE IF EXISTS public.invoice_number
    INCREMENT 2;

GET /api/databases/bookshop/schemas/2200/sequences/999999
410 {"status_code":410,"reason_phrase":"Could not find the sequence in the database. It may have been removed by another user."}
```

(The OIDs are those of the demo cluster and differ on other servers.)

### Frontend

`resources/js/api.ts` wraps the generated routes with the node client from `src/nodes/client.ts`:

```ts
export function sequences(db: string, scid: number) {
  return collection<Sequence>(collectionUrl(db, 'schemas', scid, 'sequences'))
}

export function resolveSequence(db: string, schema: string, name: string) {
  return resolve(db, 'sequence', { schema, name }).then((ids) => ({ scid: ids.scid, seid: ids.seid }))
}

export function sequenceModifiedSql(db: string, scid: number, data: SequenceData, seid?: number) {
  return sequences(db, scid).modifiedSql(data, seid)
}
```

`collection(url)` returns `list`, `nodes`, `node`, `properties`, `create`, `update`, `remove(oid, cascade)`, `sql`, `modifiedSql(data, oid?)`, `statistics(oid?)`, `dependencies`, `dependents` and `children`. `collectionUrl(null, 'databases')` addresses the server level (`/api/server/databases`).

`Pages/SequenceEditor.tsx` resolves the OIDs from the URL's names with `useRequest`, fills the form from `properties()`, and on **Preview SQL** calls `sequenceModifiedSql()` with the same payload that **Go** sends to `createSequence()` or `updateSequence()`. After saving it calls `treeState.refresh()` so the navigation tree shows the change, and navigates back to the list.
