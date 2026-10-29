# Browse

The **Browse** tab, the first tab of a table, view or materialized view, shows the relation's rows
in phpMyAdmin's results grid: page by page, sortable, filterable, and — for a table with a primary
key — editable in place. The same grid shows the results of the [SQL tab](/tools/sql) and the
[Search tab](/table/search), so everything below about the grid applies there too.

![The Browse tab of books: the message Showing rows 0 - 24 (65 total), SELECT * FROM "public"."books", the navigation bar with page selector, Show all, Number of rows, Filter rows and Sort by key, and the grid with Edit, Copy and Delete on each row](/media/sql/browse.png)

## What Browse runs

Browse runs `SELECT * FROM "schema"."table"`, paged as described in
[How paging and ordering work](/tools/sql#how-paging-and-ordering-work). Without an order of your own,
a table is sorted by its **primary key**, as pgAdmin's data view does, so a row stays in place after
you edit it. A view, a materialized view or a table without a primary key comes in the order the
server returns it, which can change between pages.

The page, the rows per page and the order are kept in the URL (`?pos=50&rows=100&order=published:desc`),
so reloading the page or using the browser's Back button returns to the same place.

::: info Inherited and partitioned tables
`SELECT * FROM parent` includes the rows of tables that inherit from it: Browse of `books` also lists
the rows of `ebooks`, and an edit or delete of such a row through `books` changes `ebooks`. A
partitioned table such as `orders` is browsed and edited through the parent; changing a value of the
partition key moves the row to the matching partition. Browse a partition or child table itself to see
only its rows.
:::

## The navigation bar

The bar appears above and below the grid.

| Control | What it does |
| --- | --- |
| **<<**, **<** | First page, previous page. Shown from the second page on. |
| Page selector | Jumps to a page. Shown when there is more than one page; with more than 200 pages it lists the first and last five, the ten around the current one and round numbers in between. |
| **>**, **>>** | Next page, last page. |
| **Show all** | Shows every row on one page (`?rows=all`). Untick to return to the default page size. |
| **Number of rows:** | 25, 50, 100, 250 or 500 rows per page. The default is the **Number of rows** setting under [Settings → Main panel](/server/settings). |
| **Filter rows:** | Hides the rows of **this page** that do not contain the text, in any column, ignoring case. It does not query the server; use [Search](/table/search) to filter the table. |
| **Sort by key:** | Tables only. **PRIMARY (ASC)/(DESC)** and the same for each index whose columns are all in the result. Indexes on expressions are left out. **None** returns to the default order. |

::: warning Show all has no upper limit
**Show all** on a large table sends every row to the browser at once. There is no cap like
phpMyAdmin's `$cfg['MaxRows']` safeguard for "all".
:::

### Sorting by a column

Click a column heading to sort by it; click it again to reverse the order. A date, time or timestamp
column starts newest first, others ascending. The grid sorts by one column at a time: clicking another
heading replaces the order. The arrow next to a heading shows the current direction.

Headings are links only when the result can be paged. On the SQL tab, results of a batch, of a
statement with its own `LIMIT`, of `EXPLAIN` and so on cannot be sorted from the grid.

## Extra options

**Extra options** opens display options for this grid:

![The Extra options card: Partial texts and Full texts radio buttons, Show binary contents, and Go](/media/sql/browse-extra-options.png)

| Option | What it does |
| --- | --- |
| **Partial texts** (default) | Cuts values longer than 50 characters and adds `...`, on one line. |
| **Full texts** | Shows values whole, wrapping lines and keeping line breaks and indentation. The **←T→** icon in the grid's corner switches between the two as well. |
| **Show binary contents** | Shows `bytea` values as their hex text (`\xdeadbeef`) instead of `[BLOB - 4 B]`. |

**Go** closes the card; the options apply as you change them. They are not saved and reset when the
page reloads.

## How values are shown

![The grid of a table with one column of many types: varchar, text cut with ..., boolean true, enum happy, date, time(3), timestamptz, numeric, double precision, jsonb, text[], bytea as [BLOB - 4 B], uuid, int4range [1,10), the composite address, tsvector, a generated column and a domain](/media/sql/browse-types.png)

| Type | Shown as |
| --- | --- |
| NULL | *NULL* in grey italics; an empty string is an empty cell |
| Numbers | Right-aligned, as PostgreSQL prints them (`12.50` for `numeric(10,2)`) |
| `boolean` | `true` / `false` (phpMyAdmin shows `1` / `0`) |
| `date`, `time`, `timestamp(tz)` | ISO text, never wrapped. `timestamptz` and `timetz` are shown in the session time zone, the server's `TimeZone` setting |
| `bytea` | `[BLOB - 4 B]`, or the hex text with **Show binary contents**. Never editable in place |
| `json`, `jsonb` | The document as text (`jsonb` normalised by the server) |
| Arrays | PostgreSQL's array text: `{x,"y z"}` |
| Composite types | Row text: `("1 High St",Leeds,"LS1 1AA",GB)` |
| Ranges | `[1,10)` |
| Enums | The label |
| `tsvector` | The lexemes with positions: `'brown':3 'fox':4 'quick':2` |
| Generated columns | The computed value, read-only |

## Editing rows

When the rows can be edited (see [below](#which-results-can-be-edited)), each row starts with a check
box and **Edit**, **Copy** and **Delete**.

| Action | What it does |
| --- | --- |
| **Edit** | Opens the [edit form](/table/insert#edit-a-row) for the row. |
| **Copy** | Opens the insert form filled with the row's values, to insert a new row like it. The primary key is left to its default when it has one. |
| **Delete** | Asks *Do you really want to execute "DELETE FROM … WHERE "id" = '5'"?* in a browser dialog and deletes the row. |

### Double-click editing

Double-click a cell to edit it in place:

<Clip src="sql/inline-edit.mp4" caption="Double-clicking a title opens it in a box; Enter saves it. Double-clicking publisher_id and ticking NULL saves NULL." />

- <kbd>Enter</kbd> saves; <kbd>Esc</kbd> cancels; clicking elsewhere saves what changed.
- Text and JSON open in a multi-line box; <kbd>Shift</kbd>+<kbd>Enter</kbd> adds a line break. A JSON
  document is laid out over several lines.
- A nullable column has a **NULL** check box under the box.
- An enum column offers its labels in a list. A foreign key column offers the referenced values
  (`description - key`) while there are at most 100 of them; beyond that the browse-foreign-values
  icon answers that it is not available, and you type the key.
- Date and time columns open the date/time picker. PostgreSQL accepts more than the picker offers
  (`infinity`, `epoch`, `today`, time zones); type those in.

Saving sends one `UPDATE "schema"."table" SET "col" = $1 WHERE "pk" = $2 RETURNING *` with the value as a
parameter, shows **1 row affected.** and reloads the page. If the server rejects the value (a check
constraint, a bad date), its message appears and the cell stays open. If another session deleted or
re-keyed the row meanwhile, the save fails with *The row to change was not found*.

### With selected

Tick rows (or **Check all**, which ticks the rows of this page that the filter shows) and pick an
action after *With selected:*:

| Action | What it does |
| --- | --- |
| **Edit** | Opens the edit form with every ticked row. |
| **Copy** | Opens the insert form with a copy of every ticked row. |
| **Delete** | Shows the `DELETE` statements in **Preview SQL**; **Yes** runs them in one transaction. |
| **Export** | Answers that it is not available; use the [Export](/tools/export) tab. |

![Preview SQL for two rows: DELETE FROM "public"."sql_books" WHERE "id" = '7'; and the same for id 8, with Yes and Close](/media/sql/bulk-delete-preview.png)

::: info
An action clicked with no row ticked answers with the "not available" message instead of asking you
to select rows.
:::

## Which results can be edited

A grid is editable when the rows can be addressed by primary key. phpPgAdmin decides it from the
result's column metadata, after pgAdmin:

1. All columns that come from a table come from **one** table. Expressions (`upper(title)`, `count(*)`)
   do not count and are shown read-only.
2. That table is an ordinary or partitioned table (not a view, materialized view, foreign table or
   sequence) and has a **primary key**.
3. Every primary key column is in the result, under its own name, once.

A column counts as the table's own when its name **and type** match a column of the table. PostgreSQL
tells the client which table a result column comes from but, through PHP's pgsql extension, not which
column, so phpPgAdmin matches by name. As a result:

- A column selected under another name (`SELECT id, title AS t …`) is read-only; if it is the
  primary key, the whole grid is read-only.
- A column selected twice is read-only in both places.
- A column of a **domain** type is read-only: the server reports the domain's base type, which does
  not match. In the demo, `books.isbn` (domain `isbn13`) and `customers.email` (domain `email`) cannot
  be double-clicked; edit them in the [edit form](/table/insert#edit-a-row) or with `UPDATE`.
- Generated columns are always read-only.

::: tip For phpMyAdmin users
phpMyAdmin can edit rows of a table without a primary key by using a unique key or all the column
values in the `WHERE` clause. phpPgAdmin only edits by primary key. Add one
(`ALTER TABLE t ADD PRIMARY KEY (id)`), or use `UPDATE … WHERE ctid = '(0,1)'` on the SQL tab for a
one-off change.
:::

## Distinct values

`…/browse?distinct=<column>` lists each value of a column with the number of rows that have it, most
frequent first. The [Structure](/table/structure) tab's **Browse distinct values** action opens it.

```sql
SELECT COUNT(*) AS "Rows", "publisher_id" FROM "public"."books" GROUP BY "publisher_id" ORDER BY "Rows" DESC
```

![Distinct values of books.publisher_id: 22 rows for publisher 1, 21 each for 3 and 2, and 1 row with NULL](/media/sql/browse-distinct.png)

The result is read-only and the URL's column name is case-sensitive (`?distinct=publisher_id`).

## Under the grid

The **Query results operations** card (**Print**, **Copy to clipboard**, **Create view**; **Export**
and **Display chart** are not available yet) and the **Bookmark this SQL query** card work as on the
SQL tab; see [Results](/tools/sql#results) and [Bookmarks](/tools/history-bookmarks#bookmark-a-query).
The message's **Edit** and **Edit inline** links open the table's SQL tab with the statement;
**Explain SQL** runs `EXPLAIN` there; **Refresh** reloads the page of rows.
