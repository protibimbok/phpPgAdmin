# Functions and procedures

A schema's **Routines** tab (`/db/<database>/schema/<schema>/routines`) lists the schema's
functions, procedures, trigger functions, aggregates and operators, and opens the routine editor.
In the navigation panel, routines sit under **Functions**, **Procedures**, **Trigger functions**,
**Aggregates** and **Operators**; clicking a function, procedure or trigger function opens its
editor, and clicking a container opens this tab.

![The Routines tab of the public schema filtered by "b": operators with Export and Drop, functions with Edit, Execute, Export and Drop](/media/schema/routines-list.png)

## The routine list

Each row shows the signature (name and argument types), the **Type** (`FUNCTION`, `PROCEDURE`,
`TRIGGER FUNCTION`, `AGGREGATE` or `OPERATOR`) and what it **Returns** (empty for a procedure; the
result type of an aggregate or operator). The links per row:

| Link | Shown for | What it does |
|---|---|---|
| **Edit** | functions, procedures, trigger functions | Opens the [routine editor](#the-routine-editor). |
| **Execute** | functions, procedures | Asks for the arguments and runs the call on the SQL tab; see [Execute a routine](#execute-a-routine). |
| **Export** | all | Shows the `CREATE` statement in a dialog with **Copy to clipboard**. |
| **Drop** | all | Asks for confirmation, then runs `DROP FUNCTION`, `DROP PROCEDURE`, `DROP AGGREGATE` or `DROP OPERATOR` with the signature. |

Above the table: **Check all**, then **Export** and **Drop** for the ticked rows (Export joins the
statements; Drop runs one statement per row and reports *N routines have been dropped.*). The
search box filters the rows by signature as you type, and **Create new routine** opens an empty
editor. With nothing ticked the bulk buttons say *No routine selected.*

::: info Extension members are listed too
Functions, operators and types that an extension installed into the schema (here `citext`,
`btree_gist` and `pg_trgm` live in `public`) are listed with your own. Dropping one fails with
*cannot drop function citext_eq(citext,citext) because extension citext requires it*. Use the
filter box to find your routines.
:::

::: info Aggregates and operators are read-only
Aggregates and operators have only **Export** and **Drop**. Create or change them on the
[SQL tab](/tools/sql) (`CREATE AGGREGATE`, `CREATE OPERATOR`), as in pgAdmin. For example,
Export on `total_price(numeric)` shows:

```sql
CREATE OR REPLACE AGGREGATE public.total_price(numeric) (
    SFUNC = price_sum_state,
    STYPE = numeric,
    INITCOND = '0'
);
```
:::

## The routine editor

**Create new routine** opens `…/routines/create`; add `?type=procedure` or
`?type=trigger_function` to start with that type. **Edit** opens
`…/routines/<kind>/<oid>/edit`. **Preview SQL** shows the statements; **Go** runs them and returns
to the list with *Routine … has been created.* or *… has been altered.*

![The editor filled in for rtn_price_band: two numeric parameters, the second with default 1000, SETOF books, a PL/pgSQL body, STABLE, SECURITY DEFINER, PARALLEL SAFE, 20 rows and search_path set](/media/schema/routines-editor.png)

Which rows appear depends on the **Type**:

| Field | Function | Procedure | Trigger function | SQL |
|---|---|---|---|---|
| **Routine name** | yes | yes | yes | |
| **Type** | `FUNCTION`, `PROCEDURE` or `TRIGGER FUNCTION`; fixed when editing | | | |
| **Parameters** | yes | yes | | the argument list |
| **Return type**, **Returns a set (SETOF)** | yes | | always `trigger` | `RETURNS [SETOF] type` |
| **Definition** | yes | yes | yes | `AS $BODY$ … $BODY$` |
| **Language** | yes | yes | yes | `LANGUAGE 'plpgsql'` |
| **Volatility** | yes | | yes | `VOLATILE` / `STABLE` / `IMMUTABLE` |
| **Strict (returns NULL on NULL input)** | yes | | yes | `STRICT` |
| **Security type** | yes | yes | yes | `SECURITY INVOKER` / `SECURITY DEFINER` |
| **Parallel** | yes | | | `PARALLEL UNSAFE` / `RESTRICTED` / `SAFE` |
| **Estimated cost** | yes | | yes | `COST n` (placeholder 100) |
| **Estimated rows** | only with SETOF | | | `ROWS n` (placeholder 1000) |
| **Leak proof** | yes | | yes | `LEAKPROOF` |
| **Owner** | yes | yes | yes | `ALTER FUNCTION … OWNER TO` |
| **Comment** | yes | yes | yes | `COMMENT ON FUNCTION` |
| **Configuration variables** | yes | yes | yes | `SET name = value` |

### Parameters

**Add parameter** adds a row with **Direction**, **Name**, **Type** and **Default**; **Remove**
deletes it.

- **Direction**: `IN`, `OUT`, `INOUT` or `VARIADIC`. `OUT` and `INOUT` parameters make up the
  result row of a function; a `VARIADIC` parameter must be last and be an array type
  (`integer[]`).
- **Type** suggests the database's types as you type (built-in and `public` types by bare name,
  others schema-qualified). Rows with an empty type are left out.
- **Default** is an SQL expression (`1000`, `'none'`, `now()`). Once one parameter has a default,
  every later input parameter needs one too.

### Return type

Type any type name, a table or view name (its row type), `void`, or `TABLE (col type, …)`.
**Returns a set (SETOF)** returns any number of rows; with it, **Estimated rows** appears. A function
with `OUT` parameters still needs a return type matching them (`record` for several).

### Definition and language

**Definition** is the body inside the dollar quotes: for PL/pgSQL the `DECLARE … BEGIN … END`
block, for `sql` the queries. A `sql` body that starts with `BEGIN ATOMIC` is written as an
SQL-standard body (no `AS`), which PostgreSQL parses at creation time and tracks dependencies for.

**Language** lists the languages installed in the database (`plpgsql`, `sql`, `c`, `internal`, and
any others you added on the database's [Languages](/database/objects) page).

::: warning C functions cannot be created in the editor
There are no fields for a C function's object file and link symbol. With **Language** `c` the
editor generates `AS NULL, NULL` and ignores the definition, so the statement fails. Create C
functions on the SQL tab:
`CREATE FUNCTION f(int) RETURNS int AS '$libdir/mylib', 'f' LANGUAGE c STRICT;`.
:::

### Options

- **Volatility**: `VOLATILE` (default) for anything with side effects or changing results;
  `STABLE` when the result is fixed within a statement (reads tables); `IMMUTABLE` only when the
  result depends on the arguments alone (needed for use in indexes).
- **Strict**: the function is not called and returns `NULL` when any argument is `NULL`.
- **Leak proof**: declares that the function reveals nothing about its arguments except through its
  result, so the planner may use it ahead of [security barrier](/schema/views#the-form) and row
  security conditions. Only a superuser can set it.
- **Parallel**: whether the function may run in parallel workers. Mark it `SAFE` only if it
  writes nothing and uses no temporary tables or cursors.
- **Estimated cost** and **Estimated rows** are planner hints in units of `cpu_operator_cost` and
  rows.

::: tip SECURITY DEFINER needs a fixed search_path
A `SECURITY DEFINER` routine runs with its owner's rights. Set `search_path` in
**Configuration variables** (name `search_path`, value `public, pg_temp`, with `pg_temp` last) so a
caller cannot put their own objects in front of the ones the routine uses, and grant `EXECUTE`
only to the roles that need it ([Privileges](/tools/privileges)). New functions are executable by
`PUBLIC` by default.
:::

### Configuration variables

**Add variable** adds a **Name** / **Value** pair. The name box suggests the server's settings. Each
pair becomes `SET name = value` on the routine, applied while it runs and restored afterwards.
The `search_path` value is written unquoted, so a list such as `public, pg_temp` works; other
values are quoted. **Remove** deletes a pair.

Options the editor does not have: `WINDOW`, `SUPPORT` functions, `TRANSFORM`, `SECURITY LABEL` and
a C function's `AS 'obj_file', 'link_symbol'`. When you edit a routine that already has a window or
support attribute, the editor keeps it.

The editor above generates:

```sql
CREATE FUNCTION public.rtn_price_band(IN lo numeric, IN hi numeric DEFAULT 1000)
    RETURNS SETOF books
    LANGUAGE 'plpgsql'
    COST 50
    STABLE STRICT SECURITY DEFINER PARALLEL SAFE
    ROWS 20

    SET search_path=public, pg_temp
AS $BODY$
BEGIN
  RETURN QUERY SELECT * FROM books WHERE price BETWEEN lo AND hi;
END
$BODY$;

COMMENT ON FUNCTION public.rtn_price_band(numeric, numeric)
    IS 'Books in a price band';
```

<Clip src="schema/routines-create-execute.mp4" caption="Creating rtn_books_between(lo numeric, hi numeric) RETURNS bigint, then Execute with 10 and 20: the call runs on the SQL tab and returns 21." />

## Edit a routine

The editor for an existing routine shows its current settings. A **Debug** link appears above the
form for PL/pgSQL functions and procedures when the database has the debugger extension; see
[Debugger](/tools/debugger).

How a change is applied:

- **Routine name** changes run `ALTER FUNCTION … RENAME TO`.
- **Owner** and **Comment** run `ALTER FUNCTION … OWNER TO` and `COMMENT ON FUNCTION`.
- Anything else (body, options, variables, parameter names and defaults) runs
  `CREATE OR REPLACE FUNCTION` (or `PROCEDURE`) with the full new definition. Grants and
  dependent triggers stay.

You cannot add or remove parameters of an existing routine: the hint says
*PostgreSQL cannot add or remove a parameter of an existing routine; create a new one instead.*

::: warning What CREATE OR REPLACE cannot change
PostgreSQL identifies a routine by its name and input argument types, and `CREATE OR REPLACE`
cannot change the result. So:

- **Return type**: changing it fails with *cannot change return type of existing function*. That
  includes adding or removing `SETOF` and changing `OUT` parameters. Drop the function and create
  it again (dependent triggers, views and defaults must be dropped first).
- **Parameter types**: changing an argument's type does not alter the routine. The statement
  creates a **second function** (an overload) with the new signature and leaves the old one in
  place; the editor still reports *Routine … has been altered.* Drop the old signature from the
  list afterwards.
- Renaming a parameter or removing a default is refused by PostgreSQL
  (*cannot change name of input parameter*, *cannot remove parameter defaults from existing
  function*).
:::

### Statistics, Dependencies and Dependents

Below an existing routine's form:

- **Statistics**: **Number of calls**, **Total time** and **Self time** (milliseconds) from
  `pg_stat_user_functions`.
- **Dependencies**: the types, language and schema the routine uses.
- **Dependents**: triggers, views, defaults and other objects that use it.

![The editor of apply_discount(numeric, numeric) with the Debug link, and the Statistics, Dependencies and Dependents panels below the form](/media/schema/routines-panels.png)

::: info Call counts need track_functions
PostgreSQL counts calls only while `track_functions` is `pl` (PL functions) or `all` (also SQL
and C functions). With it off, the panel says
*No calls have been counted: PostgreSQL counts a routine's calls only while track_functions is pl
(or all, for SQL and C routines too).* SQL functions that the planner inlines are never counted.
Change the setting on the server's [Variables](/server/variables) page.
:::

## Execute a routine

**Execute** opens **Routine parameters** with one row per input parameter: **Name**, **Type**, a
**Value** box and a **NULL** box. **Go** builds the call and runs it on the schema's
[SQL tab](/tools/sql), where you see the result grid (or the error):

- a function: `SELECT * FROM "public"."rtn_price_band"(10, 12)`
- a procedure: `CALL "public"."restock"(…)`

A routine without input parameters runs at once, without the dialog.

![The Routine parameters dialog for rtn_price_band with lo = 10 and hi = 12](/media/schema/routines-execute.png)

Numbers and `true`/`false` are passed as typed; everything else becomes a literal cast to the
parameter's type (`'2026-01-01'::date`). Tick **NULL** to pass `NULL`.

::: warning Limits of the Execute dialog
- **Empty boxes are not "use the default".** An empty value is sent as `''::type`, so a parameter
  with a default fails (*invalid input syntax for type numeric: ""*) unless you fill it in. To use
  defaults, edit the call on the SQL tab and leave the trailing arguments out.
- **Procedures with OUT parameters fail.** The dialog leaves `OUT` parameters out of the `CALL`,
  but a procedure's `OUT` parameters must be passed (as `NULL`), so you get
  *procedure public.rtn_proc(integer) does not exist*. Run `CALL public.rtn_proc(21, NULL);` on the
  SQL tab instead.
- **VARIADIC parameters fail.** The array you type is passed as one argument without the
  `VARIADIC` keyword (*function public.rtn_sum(integer[]) does not exist*). Run
  `SELECT public.rtn_sum(1, 2, 3)` or `SELECT public.rtn_sum(VARIADIC '{1,2,3}')` instead.
:::

### Procedures and transactions

Procedures differ from functions:

- They are run with `CALL`, not in a `SELECT`, and return no value except through `OUT`/`INOUT`
  parameters (shown as a one-row result).
- They can `COMMIT` and `ROLLBACK` inside their body. That only works when the `CALL` is not inside
  an explicit transaction: with **Run as one transaction** ticked on the SQL tab, a procedure that
  commits fails with *invalid transaction termination*. Run it with the box cleared.
- They have no volatility, strictness, parallel, cost or leakproof settings, which is why the
  editor hides those rows.

Trigger functions return `trigger`, take no declared parameters (they read `NEW`, `OLD`, `TG_OP`
and `TG_ARGV`) and are attached to tables and views on the [Triggers](/table/triggers) tab. They
have no **Execute** link.

## Drop a routine

**Drop** shows the statement, for example
`DROP FUNCTION "public"."rtn_price_band"(numeric, numeric);`, and runs it on **OK**. There is no
CASCADE option: a function used by a trigger, a view, a column default or another object fails
with *cannot drop function … because other objects depend on it*. Check **Dependents** in the
editor and drop those first, or run `DROP FUNCTION … CASCADE` on the SQL tab.
