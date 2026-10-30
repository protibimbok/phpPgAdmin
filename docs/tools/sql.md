# SQL editor

The **SQL** tab runs any SQL you type: one statement or a batch, with paged and sortable results,
inline editing of rows from a single table, EXPLAIN, bookmarks and macros. It appears at four
levels — the server, a database, a schema and a table (or view) — and works the same at each,
except for what the box starts with and which database the statements run in.

![The SQL tab of the books table: the editor with SELECT * FROM "public"."books" WHERE true, the column list on the right, the quick buttons, Bind parameters, the bookmark label and the options in the footer](/media/sql/sql-tab-table.png)

## Where the statements run

| Level | URL | Runs in | The box starts with |
| --- | --- | --- | --- |
| Server | `/server/sql` | The database you signed in to (the maintenance database, usually `postgres`) | empty |
| Database | `/db/<db>/sql` | That database | empty |
| Schema | `/db/<db>/schema/<schema>/sql` | That database | empty |
| Table / view | `…/<table>/sql` | That database | `SELECT * FROM "schema"."table" WHERE true` |

::: warning A schema's SQL tab does not set the search path
The schema level only changes the heading and the default schema for completions. Statements still
run with the role's normal `search_path` (usually `"$user", public`), so write
`inventory.stock`, not `stock`, when you are on the `inventory` schema's SQL tab.
:::

::: info Every run is a new session
Each click on **Go** opens a fresh connection. `SET` commands, temporary tables, prepared
statements and `LISTEN` do not survive to the next run. Put the `SET` in the same batch as the
statements that need it. An explicit `BEGIN` without `COMMIT` in a batch is rolled back when the
run ends — nothing is kept and no warning is shown. Use [Run as one transaction](#transactions)
instead.
:::

At the server level there is no bookmark field, no **Bookmarked SQL query** card, no completions for
tables and columns, and **Create view** answers that it is not available.

## The editor

The box is a CodeMirror editor with PostgreSQL syntax colouring, line numbers, bracket matching
and automatic closing of brackets and quotes.

| Key | What it does |
| --- | --- |
| <kbd>Ctrl</kbd>+<kbd>Enter</kbd> (<kbd>Cmd</kbd>+<kbd>Enter</kbd>) | Runs the query (same as **Go**) |
| <kbd>Tab</kbd> | Indents; it does not leave the box |
| <kbd>Ctrl</kbd>+<kbd>Space</kbd> | Opens the completion list |
| <kbd>Ctrl</kbd>+<kbd>Z</kbd> / <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>Z</kbd> | Undo / redo |
| <kbd>Ctrl</kbd>+<kbd>0</kbd>…<kbd>9</kbd>, <kbd>Alt</kbd>+<kbd>F1</kbd>…<kbd>F12</kbd> | Run the macro bound to that key ([Macros](/tools/history-bookmarks#macros)) |

### Completions

As you type, the editor offers SQL keywords and, at database level and below, the database's schemas,
tables, views, materialized views and foreign tables, and their columns. Type a schema name and a
dot for its relations; type a table name or alias and a dot for its columns. Tables in `public` are
also offered without a schema prefix. <kbd>Enter</kbd> or
<kbd>Tab</kbd> accepts the highlighted entry; <kbd>Esc</kbd> closes the list.

<Clip src="sql/autocomplete.mp4" caption="Typing SELECT * FROM inventory. offers the schema's tables; s. after the alias offers the columns of inventory.stock." />

::: info
The list of tables and columns is read once when the page opens. A table you create in the editor is
not offered until you reload the page. `pg_catalog` and `information_schema` are not offered.
:::

### Buttons under the editor

| Button | What it does |
| --- | --- |
| **SELECT \***, **SELECT**, **INSERT**, **UPDATE**, **DELETE** | Table level only. Replace the box with a template for the table, every column quoted. INSERT and UPDATE use `'[value-1]'`, `'[value-2]'`… placeholders; DELETE ends in `WHERE false` so it deletes nothing until you change it. |
| **Clear** | Empties the box. |
| **Format** | Reformats the query (keywords upper case, one clause per line) with sql-formatter's PostgreSQL dialect. A query it cannot parse shows the error and stays as it was. |
| **Macros** | The [macros menu](/tools/history-bookmarks#macros). |
| **Get auto-saved query** | Puts back the last text typed in any SQL box of this browser. |
| **<<** (next to the column list) | Table level only. Inserts the selected columns, quoted and comma-separated, at the cursor. Select several with <kbd>Ctrl</kbd>/<kbd>Shift</kbd>. |

::: warning The INSERT and UPDATE templates list every column
They include identity, serial and generated columns. Remove `search` from the `books` template, for
example, or the statement fails with *cannot insert a non-DEFAULT value into column "search"*.
:::

::: tip Auto-save
Whatever you type is saved in the browser's local storage as you type, under one key shared by every
SQL box (server, database, schema and table level) and every database. **Get auto-saved query**
restores the latest text, wherever you typed it. Nothing is stored on the server, so it does not
follow you to another browser.
:::

## Running a query

1. Type or paste the SQL.
2. Choose the options in the card's footer (below).
3. Click **Go** or press <kbd>Ctrl</kbd>+<kbd>Enter</kbd>.

As in phpMyAdmin, **Go** empties the box and folds it away; a **Show query box** link brings it back.
Two footer options change that:

| Option | What it does |
| --- | --- |
| **Delimiter** | The statement separator, `;` by default. Any string works, for example `$$` or `//`. It is only needed for unusual scripts: dollar-quoted function bodies are already kept whole (see [Batches](#batches)). |
| **Show this query here again** | Keeps the query in the box after **Go**. |
| **Retain query box** | Keeps the box open after **Go**. |
| **Rollback when finished** | Runs the batch in a transaction and rolls it back at the end. See [Transactions](#transactions). |
| **Run as one transaction** | Runs the batch in one transaction, committed at the end, rolled back on the first error. |

### Confirmation of destructive statements

With the **Confirm DROP queries** setting on (the default, under
[Settings → Features](/server/settings)), the editor asks before it runs a batch containing `DROP …`,
`ALTER TABLE … DROP …`, `DELETE FROM …`, `TRUNCATE …`, or an `UPDATE` without `WHERE`.

![The Confirm dialog: Do you really want to execute "DELETE FROM sql_books WHERE id = 1"?, with OK and Cancel](/media/sql/confirm-delete.png)

::: info
The check looks at the first word of each statement (comments are skipped). A `DELETE` inside a
`WITH` query or a function that drops something are run without asking.
Statements run from the [console](/tools/console) and links that open the SQL tab with a statement
to run (from another page or a bookmark in the browser) are checked too. Macros and **Edit inline**
are not, nor are statements another page has already confirmed (its own Delete or Drop dialog).
:::

## Results

Each statement of the run gets its own message: a green box with the outcome and the time it took,
the statement with syntax colouring, and links under it.

![A SELECT result: Showing rows 0 - 5 (6 total, Query took 0.0013 seconds), the statement, the Edit inline, Edit, Explain SQL and Refresh links, the navigation bar and the rows](/media/sql/select-result.png)

| Statement | Message |
| --- | --- |
| Returns rows | **Showing rows 0 - 24 (65 total, Query took … seconds.)** — rows are numbered from 0, as in phpMyAdmin |
| Returns no rows | **PostgreSQL returned an empty result set (i.e. zero rows).** |
| `INSERT` / `DELETE` | **3 rows inserted.** / **1 row deleted.** |
| `UPDATE`, `MERGE`, `COPY` | **2 rows affected.** |
| Anything else (`CREATE`, `SET`, `DO`, `VACUUM`…) | **Your SQL query has been executed successfully.** |

The links under a message:

| Link | What it does |
| --- | --- |
| **Edit inline** | Turns the statement into a text box with **Go** and **Cancel**; **Go** runs the edited text as a new query. |
| **Edit** | Puts the statement back in the query box and scrolls up. From the Browse page it opens the table's SQL tab with the statement. |
| **Explain SQL** | For `SELECT`, `WITH`, `VALUES` and `TABLE` statements: runs `EXPLAIN` on it. On an `EXPLAIN` result it reads **Skip Explain SQL** and runs the statement without `EXPLAIN`. |
| **Explain analyze** | For the same statements, unless they write through a `WITH` clause: runs `EXPLAIN (ANALYZE, BUFFERS)`, which executes the statement. |
| **Refresh** | Runs the statement again with the same page and order; under a batch, that statement alone. |

Below a row-returning statement come the [results grid](/table/browse) — the same
grid as the Browse tab — the **Query results operations** card and the
[**Bookmark this SQL query**](/tools/history-bookmarks#bookmark-a-query) card.

**Query results operations** has **Print**, **Copy to clipboard** (the rows on this page as
tab-separated text with a header line, `NULL` written out), **Export**, **Display chart** and
**Create view**. **Export** opens the [Export page for the query's rows](/tools/export#query-results)
(every row, not only this page). **Display chart** opens the [chart](#display-chart) of them.

### Display chart

**Display chart** (`/db/<database>/chart`) is phpMyAdmin's chart page for the statement's rows:

- **Bar** (horizontal), **Column**, **Line**, **Spline**, **Area**, and **Pie** when one series is
  chosen; **Stacked** for bars, columns and areas.
- **Chart title**, the **X-Axis** column (the first one to begin with) and the **Series** (every
  other numeric column), and the two axis labels.
- **Series names are in a column**: for rows in long form, a **Series column** whose values name
  the series and a **Value Column** with their numbers, one series per distinct name.
- **Start row** and **Number of rows** run the statement again for that slice of its rows; **Go**
  applies them.
- **Save chart as image** downloads the chart as `chart.png`.

Hovering a bar, point or slice shows its series, X value and value.

### How paging and ordering work

When the query box holds **one** statement that returns rows (`SELECT`, `VALUES`, `TABLE`, or
`WITH … SELECT`), phpPgAdmin pages it by wrapping it:

```sql
SELECT * FROM (
<your statement>
) _pga ORDER BY "title" ASC LIMIT 26 OFFSET 25
```

It asks for one row more than the page to know whether there is a next page, and runs
`SELECT count(*) FROM (<your statement>) _c` for the total when there is. A click on a column
heading changes the `ORDER BY` of the wrapper, so it overrides any `ORDER BY` of your own. The rows
per page come from the **Number of rows** setting (MaxRows, 25 by default) under
[Settings → Main panel](/server/settings).

These statements are **not** paged or sortable; the grid shows every row they return and the
headings are not links:

- a statement with its own `LIMIT`, `OFFSET`, `FETCH` or `FOR UPDATE/SHARE`;
- `SELECT … INTO`, `INSERT/UPDATE/DELETE/MERGE … RETURNING`, and a `WITH` holding one of them;
- `SHOW`, `EXPLAIN`, `FETCH` and any other statement that returns rows.

Their grids have no page links, **Show all** or **Number of rows**, since paging would run the
statement again. The statements of a batch of two or more show all their rows too, but a SELECT
among them keeps its navigation: using it runs that SELECT again on its own (see
[Batches](#batches)).

::: warning No row limit on unpaged results
An unpaged statement returns all its rows to the browser. `SELECT * FROM big_table LIMIT 1000000`,
or `SELECT * FROM big_table;` as part of a batch, loads every row into the page. Give large
queries a `LIMIT` that you can live with, or run them alone so they are paged.
:::

::: info The in-memory fallback
Some single SELECTs cannot be wrapped in a subquery, for example one whose result has two columns
with the same name (`SELECT id AS a, title AS a FROM books` sorted by `a`). When the server rejects
the wrapped statement before running it (a syntax error, or an `ORDER BY` column it cannot pick
out), phpPgAdmin runs your statement as written, fetches every row and pages them in memory. The
total is then exact, but a click on a heading does not change the order. An error while the
statement runs, or a [cancel](#cancelling-a-running-query), is reported as it is; the statement is
not run a second time.
:::

::: warning Paging runs the statement again
Paging runs your statement again for every page, and again for the total count. Volatile functions
(`nextval()`, `random()`, functions that write) in a paged SELECT therefore run more often than you
expect. Put side effects in statements that do not return rows, or add a `LIMIT` so the statement
is not paged.
:::

### Batches

Type several statements separated by `;` (or your **Delimiter**). phpPgAdmin splits the text the
way psql does: a `;` inside `'strings'`, `E'escapes'`, `"identifiers"`, `$tag$ dollar quotes $tag$`,
`-- line comments` or `/* nested /* block */ comments */` does not end a statement, so a
`CREATE FUNCTION … AS $$ … $$` body is sent whole.

The statements run one after the other. Each gets its own message and, if it returns rows, its own
grid. The run **stops at the first error**; the statements after it are not run and get no message.

![A batch of four statements: a count with its grid, a DO block with its NOTICE, an error box for SELECT nope FROM books, and nothing for the fourth statement](/media/sql/batch-result.png)

The grids of a batch show all their rows. Changing **Number of rows**, ticking **Show all**,
clicking a heading or **Refresh** under one of them runs **only that SELECT** again, on its own,
as phpMyAdmin does: the results of the batch are replaced by that statement's paged result, and the
other statements (an `INSERT` before it, say) are not run again.

### Notices

`NOTICE`, `WARNING`, `INFO` and `LOG` messages a statement raises (`RAISE NOTICE` in PL/pgSQL,
`DROP … IF EXISTS` on something missing, `VACUUM VERBOSE`) appear in a blue box under that
statement's message, prefixed with their level.

### Errors

A failed statement gets a red **Error** box with the statement, a **Copy** link and an edit icon,
and **PostgreSQL said:** with the SQLSTATE code, the message, and the `Detail:` and `Hint:` lines when
the server sent them (see the batch above).

::: info Error position
PostgreSQL reports where in the statement a syntax error is (`position`), and phpPgAdmin receives
it, but the error box does not mark it. Count from the start of the failing statement shown in the
box, not from the start of the batch.
:::

## Transactions

Without either option every statement commits on its own: in a batch that fails at the third
statement, the first two stay done.

| Option | What happens |
| --- | --- |
| **Run as one transaction** | `BEGIN` before the first statement, `COMMIT` after the last. The first error rolls everything back: the messages of the statements before it end in **[ROLLBACK occurred.]**, and the error box shows the real error. |
| **Rollback when finished** | `BEGIN` before the first statement, `ROLLBACK` after the last, so you can try a change and see its effect without keeping it. The last message ends in **[ROLLBACK occurred.]** |

::: warning Not in a transaction block
Statements that cannot run in a transaction block (`VACUUM`, `CREATE DATABASE`,
`CREATE INDEX CONCURRENTLY`, `ALTER SYSTEM`) fail under both options.
:::

## Bind parameters

Tick **Bind parameters** to use named placeholders. Each `:name` in the query (outside strings,
quoted identifiers, comments and `::type` casts) gets a text field; the value replaces the
placeholder as a quoted literal when the query runs.

![Bind parameters ticked: fields for :author (3) and :min_price (20) under SELECT id, title FROM books WHERE author_id = :author AND price > :min_price](/media/sql/bind-parameters.png)

```sql
-- typed
SELECT id, title FROM books WHERE author_id = :author AND price > :min_price
-- run
SELECT id, title FROM books WHERE author_id = '3' AND price > '20'
```

::: info
Values are always sent as quoted literals, which PostgreSQL casts to the column's type. To bind
something that is not a value (a table name, a list for `IN`), write it into the query instead. A
placeholder whose field you never typed in is left as `:name`, which fails with *syntax error at or
near ":"*. The statement shown in the results is the one with the values filled in.
:::

## EXPLAIN

**Explain SQL** under a SELECT runs plain `EXPLAIN` (estimates only; the query is not executed). The
plan comes back as rows of one **QUERY PLAN** column. Switch the grid's **Extra options** to
**Full texts** to see the lines whole, with their indentation.

![The plan of SELECT * FROM books WHERE author_id = 3: an Append over a Seq Scan on books and one on ebooks, each with Filter: (author_id = 3)](/media/sql/explain.png)

For actual times and row counts use **Explain analyze**, which runs
`EXPLAIN (ANALYZE, BUFFERS) SELECT …`; the console's **Explain analyze** does the same. `ANALYZE`
executes the statement, writes included, so for an `UPDATE` type it yourself and wrap it in
**Rollback when finished** to measure it without keeping the change.
`EXPLAIN (FORMAT JSON)` returns one cell: use **Full texts** or **Copy to clipboard** to read it.
**Skip Explain SQL** strips `EXPLAIN` and its options and runs the statement itself.

::: tip For phpMyAdmin users
There is no "Profiling" checkbox. `EXPLAIN (ANALYZE, BUFFERS, TIMING)` is the PostgreSQL way to see
where the time goes.
:::

## Cancelling a running query

While a query runs, **Running the query… Cancel** appears under the editor. **Cancel** asks the server
to cancel the statement (`pg_cancel_backend()` from a separate connection). The statement ends with
*57014: canceling statement due to user request*.

![While SELECT pg_sleep(4) runs: the Loading notice and Running the query… Cancel under the editor](/media/sql/running.png)

A cancelled statement is not run again, and in a batch the statements after it are not run. Under
**Run as one transaction** the cancel rolls the batch back like any other error.

Leaving the page does not send a cancel. To stop a statement you can no longer reach, cancel its
backend on [Status → Processes](/server/status).

## Editing results

When every column of the result comes from **one table with a primary key** and the whole key is
among the columns, the grid gets **Edit**, **Copy** and **Delete** links, check boxes and
double-click editing, exactly as on the [Browse tab](/table/browse#editing-rows). Expressions,
renamed columns and columns that are not editable (generated columns, domain-typed columns) are
shown but cannot be edited. Results of a join, a view, or a table without a primary key are
read-only. See [Which results can be edited](/table/browse#which-results-can-be-edited) for the
full rules.

## Create a view from a result

**Create view** under a result opens the Create view form in a dialog with your statement in the
**AS** box. Fill in **VIEW name** (and optionally the schema, **Materialized**, **OR REPLACE**, column
names, **WITH CHECK OPTION**, **Security barrier**) and click **Go**. The new view's structure page
opens. See [Views](/schema/views) for the form's fields.

![The Create view dialog with SELECT id, title, price FROM books WHERE price > 36 in the AS box](/media/sql/create-view.png)

The dialog takes the statement that produced that result — in a batch, the statement under which you
clicked — without the paging wrapper.

## History, bookmarks and macros

Every statement you run here, on the Browse and Search tabs and from the console is kept in the
[query history](/tools/history-bookmarks#query-history). Save a query under a name with the
**Bookmark this SQL query** field or card ([Bookmarks](/tools/history-bookmarks#bookmarks)), or
bind it to a key ([Macros](/tools/history-bookmarks#macros)).

## Differences from phpMyAdmin

- PostgreSQL has no `USE db`; each SQL tab runs in its database. To query another database, open its
  SQL tab (or use `dblink`/`postgres_fdw`).
- Identifiers are folded to lower case unless double-quoted, and string literals take single
  quotes only: `"Title"` is a column name, `'Title'` is a string.
- `SHOW TABLES`, `DESCRIBE t` and `SHOW CREATE TABLE` do not exist. Query `information_schema` or
  `pg_catalog`, or use the [Structure](/table/structure) and **Show create** tabs.
- Booleans are shown as `true` and `false`, not `1` and `0`.
- An error inside a transaction aborts the whole transaction, not only the failing statement; see
  [Transactions](#transactions).
