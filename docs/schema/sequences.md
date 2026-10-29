# Sequences

A schema's **Sequences** tab (`/db/<database>/schema/<schema>/sequences`) lists the schema's
sequences and opens the sequence editor. phpMyAdmin has no counterpart: MySQL's
`AUTO_INCREMENT` is a column attribute, while PostgreSQL keeps the counter in a separate sequence
object. In the navigation panel, sequences sit under **Sequences**; clicking one opens its editor.

![The Sequences tab of the public schema: each sequence's current value, increment, bounds, cache, cycle flag and owning column](/media/schema/sequences-list.png)

## The sequence list

The columns are **Name**, **Current value**, **Increment**, **Minimum**, **Maximum**, **Cache**,
**Cycled**, **Owned by** (the `table.column` the sequence belongs to) and **Comment**, with
**Edit**, **Export** and **Drop** per row. Above the table: **Check all** with bulk **Export** and
**Drop**, the filter box (matches the name as you type) and **Create new sequence**.

Sequences behind `serial` and identity columns are listed too, for example `books_id_seq` owned by
`books.id`.

The list and the editor show bigint values in full, for example the default maximum
`9223372036854775807` of a bigint sequence.

## Create a sequence

**Create new sequence** opens `…/sequences/create`. Empty fields use PostgreSQL's defaults.

| Field | What it does | SQL |
|---|---|---|
| **Sequence name** | The name. | `CREATE SEQUENCE public.rtn_seq` |
| **Owner** | **(current role)** or a role. | `ALTER SEQUENCE … OWNER TO` |
| **Comment** | | `COMMENT ON SEQUENCE` |
| **Increment** | Step between values; negative counts down. Default 1. | `INCREMENT 5` |
| **Start** | First value returned. Default: the minimum (ascending) or maximum (descending). | `START 100` |
| **Minimum** / **Maximum** | Bounds. Defaults: 1 and 2⁶³−1 for an ascending bigint sequence. | `MINVALUE 100` / `MAXVALUE 200` |
| **Cache** | How many values each session reserves at a time. Default 1. | `CACHE 10` |
| **Cycled** | Wrap around to the other bound instead of failing at the end. | `CYCLE` / `NO CYCLE` |
| **Unlogged** | Not WAL-logged: faster, but reset after a crash and not replicated (PostgreSQL 15+). | `CREATE UNLOGGED SEQUENCE` / `SET UNLOGGED` |
| **Owned by** | A table of this schema, then one of its columns. The sequence is dropped with that column or table. **(none)** removes the link. | `ALTER SEQUENCE … OWNED BY public.books.pages` |

**Preview SQL** shows the statements, **Go** creates the sequence and returns to the list with
*Sequence … has been created.* For example:

```sql
CREATE SEQUENCE public.rtn_seq
    CYCLE
    INCREMENT 5
    START 100
    MINVALUE 100
    MAXVALUE 200
    CACHE 10;
```

The hint under **Owned by** reads
*A sequence owned by a column is dropped with it; the table must be in this schema.*

::: info Not in the form
- **Data type** (`AS smallint | integer | bigint`): new sequences are `bigint`. To make an
  `integer` sequence, run `CREATE SEQUENCE … AS integer` on the [SQL tab](/tools/sql). The
  editor keeps the type of an existing sequence.
- **RESTART**: there is no Restart field; use [Current value](#current-value) or
  `ALTER SEQUENCE … RESTART WITH n`.
- To use a sequence as a column default, set the column's default to `nextval('rtn_seq')` on the
  table's [Structure](/table/structure) tab, or use an identity column.
:::

## Edit a sequence

**Edit** (or clicking the sequence in the navigation panel) opens `…/sequences/<name>/edit`. The
form has the same fields, except **Start**, which is replaced by **Current value**. Changes run as
`ALTER SEQUENCE` statements: `RENAME TO` for the name, `OWNER TO`, `OWNED BY`, `SET UNLOGGED` /
`SET LOGGED`, `COMMENT ON SEQUENCE`, and one `ALTER SEQUENCE` with the changed `INCREMENT`,
`MINVALUE`, `MAXVALUE`, `CACHE` and `CYCLE` settings.

![The editor of invoice_number: name, owner, comment, current value 1000, increment, bounds, cache, cycle, unlogged and owned-by fields, then the Statistics, Dependencies and Dependents panels](/media/schema/sequences-editor.png)

Only the fields you changed are sent as clauses: a bound you leave alone is not repeated in the
`ALTER SEQUENCE`.

### Current value

**Current value** shows the sequence's `last_value`. Changing it runs `setval` with `false`, so the
**next** `nextval()` returns exactly the number you typed:

```sql
SELECT setval('public.rtn_seq', 150, false);
```

::: info Why the current value can be ahead
With **Cache** above 1, each session that calls `nextval()` reserves a block of values, and
`last_value` records the end of that block. After two `nextval()` calls on a sequence with
increment 5 and cache 10 that returned 100 and 105, **Current value** shows 145. Values reserved
by sessions and never used are skipped: sequences are not gap-free, and a rolled-back transaction
does not give its value back either.
:::

### Statistics, Dependencies and Dependents

Below the form: **Statistics** (**Blocks read** and **Blocks hit** from
`pg_statio_all_sequences`), **Dependencies** (the schema; the owning column) and **Dependents**
(column defaults that call `nextval` on it, listed as **Function** `nextval('rtn_seq'::regclass)`).

## Export and drop

**Export** shows the `CREATE SEQUENCE` statement with its owner, comment and grants, and **Copy to
clipboard**. It does not include the current value; add
`SELECT setval('public.rtn_seq', …);` yourself when copying a sequence to another database.
For data and sequence values together, use [Export](/tools/export).

**Drop** shows `DROP SEQUENCE "public"."rtn_seq";` with
**Also the objects that depend on it (CASCADE)**. Without CASCADE, a sequence used in a column
default fails with *cannot drop sequence rtn_seq because other objects depend on it*; with it, the
defaults are removed and the columns stay. A sequence **owned
by** a column is dropped automatically when that column or its table is dropped.

::: tip Identity columns
A sequence behind an `IDENTITY` column is managed through the column. Change its options with
`ALTER TABLE … ALTER COLUMN … SET INCREMENT BY …` or `RESTART`; dropping it directly is refused.
:::
