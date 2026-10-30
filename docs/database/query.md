# Multi-table query

The **Query** tab of a database (`/db/<database>/query`) is phpMyAdmin's multi-table query: you pick
columns of the database's tables, with criteria and sorting, and it writes the `SELECT` that joins
them on their foreign keys. The tables are listed as `schema.table`, with their columns and foreign
keys as the [Designer](/database/designer) reads them.

## Building the query

Each card is one column of the query:

- the **table** (`select table`) and the **column** (`select column`, or `*` for all of them);
- **Show**: whether the column is in the `SELECT` list (a column can serve only as a criterion);
- **Table alias** and **Column alias**: `AS` names; a table's alias is used everywhere it is named;
- **criteria** (the box or the link) opens the column's criterion:
  - **Sort**: **Ascending** or **Descending** adds it to `ORDER BY`;
  - **Add as**: `AND` or `OR` with the criterion before it;
  - **Column**: the column compared (the card's own by default);
  - **Op**: `=`, `>`, `>=`, `<`, `<=`, `!=`, `LIKE`, `LIKE %...%`, `NOT LIKE`, `NOT LIKE %...%`,
    `IN (...)`, `NOT IN (...)`, `BETWEEN`, `NOT BETWEEN`, `IS NULL`, `IS NOT NULL`, and phpMyAdmin's
    `REGEXP`, `REGEXP ^...$` and `NOT REGEXP`, written as PostgreSQL's `~` and `!~`;
  - **Text** (the value; for `IN` values separated by commas, for `BETWEEN` two of them) or
    **Another column** (a table and column to compare with).

The × of a card removes it; **+ Add column** adds one.

**Update query** writes the statement into the box below:

```sql
SELECT o.id, c.name AS customer, o.total
FROM public.orders AS o
	LEFT JOIN public.customers AS c ON o.customer_id = c.id
WHERE o.total > '100' AND c.name LIKE '%a%'
ORDER BY o.total DESC;
```

The first table used comes first; each other one is `LEFT JOIN`ed on a foreign key it has with a table
already in the query, in either direction (all its columns for a composite key). A table with no such
key is added after a comma, a cross join: add a criterion that links it. Values are written as
quoted literals and names as quoted identifiers where they need it. You can edit the statement in the
box before running it.

**Copy query** copies it, and **Submit query** opens it on the database's [SQL page](/tools/sql) and
runs it there, with the usual results and their operations. phpMyAdmin shows the results under the
form instead.

**Query window** folds the form away and back.

phpMyAdmin's other kind of query, *Query by example* (a grid of columns with criteria rows), is not
built; the multi-table query covers the same ground.
