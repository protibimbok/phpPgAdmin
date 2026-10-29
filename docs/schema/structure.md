# Tables in a schema

A schema's **Structure** tab lists its tables, views and materialized views in the layout of phpMyAdmin's database structure page, with per-row actions, bulk actions and the **Create new table** card. It is the page you land on when you open a schema, at `/db/<database>/schema/<schema>`.

![The Structure tab of the public schema: the filter, the table list with its action links, row estimates, types and sizes](/media/schema/tables-structure.png)

## Where it fits

PostgreSQL has one more level than MySQL: a database holds schemas, and a schema holds the tables. phpMyAdmin's database Structure page therefore lives one level lower here, on the schema. The database-level Structure tab lists the schemas instead (see [Schemas](/database/schemas)).

In the navigation tree, clicking a schema's **Tables** or **Statistics** container also opens this page.

## The tabs at schema level

| Tab | What it is for |
| --- | --- |
| **Structure** | This page. |
| **SQL** | The [SQL editor](/tools/sql), with the schema as the search path. |
| **Export** | [Export](/tools/export) the schema or chosen tables. |
| **Import** | [Import](/tools/import) a SQL or CSV file into the schema. |
| **Operations** | Rename, owner and comment of the schema: [Schema operations](/schema/operations). |
| **Privileges** | [Privileges](/tools/privileges) on the schema. |
| **Routines** | [Functions and procedures](/schema/routines). |
| **Sequences** | [Sequences](/schema/sequences). |
| **Types** | [Types, domains and collations](/schema/types). |
| **Foreign tables** | Tables of a foreign server: [Foreign data](/database/foreign-data). |

## The table list

Each row is one relation. The list holds ordinary tables, partitioned tables, views and materialized views, sorted by name.

| Column | What it shows |
| --- | --- |
| Checkbox | Selects the row for **With selected**. |
| **Table** | The name; it links to the relation's **Browse** tab. A **System** badge marks a system table. |
| **Action** | **Browse**, **Structure**, **Search**, **Insert**, **Empty**, **Drop** (see below). |
| **Rows** | The planner's estimate, `~64`, from `pg_class.reltuples`. Click it for the exact `count(*)`. `?` means the table has never been analyzed or vacuumed. Views and materialized views show nothing. |
| **Type** | **Table**, **Partitioned table**, **View** or **Materialized view**. |
| **Size** | `pg_total_relation_size`: heap, indexes and TOAST together. A partitioned table shows `0 B`; its data lives in the partitions. |
| **Comment** | The `COMMENT ON` text. |

The footer row gives the number of relations and the sums of the rows and sizes. The sum uses the estimates, or the exact count for rows you clicked.

::: info Row counts are estimates
PostgreSQL does not keep an exact row count the way MyISAM does. The number comes from the last `VACUUM`/`ANALYZE` (or autovacuum), so it can lag behind after bulk changes. A freshly created or never-analyzed table shows `?`. Click the number to run `SELECT count(*)`, which reads the whole table.
:::

::: info Partitions are not listed
The partitions of a partitioned table (for example `orders_2025` and `orders_2026` of `orders`) do not appear in this list. Reach them from the partitioned table's [Partitions card](/table/partitions#the-partitions-card) or from the navigation tree. A table you detach from its parent appears again as an ordinary table.
:::

### Filtering the list

The **Filters** card narrows the list to the names that contain what you type in **Containing the word:**. The match is case-insensitive and updates as you type. The footer sums follow the filter.

### Row actions

| Action | What it does |
| --- | --- |
| **Browse** | Opens the [Browse](/table/browse) tab. |
| **Structure** | Opens the table's [Structure](/table/structure) tab (or the view's). |
| **Search** | Opens the [Search](/table/search) tab. |
| **Insert** | Opens the [Insert](/table/insert) tab. Tables only. |
| **Empty** | Asks, then runs `TRUNCATE TABLE schema.table;`. Tables only. |
| **Drop** | Asks, then runs `DROP TABLE`, `DROP VIEW` or `DROP MATERIALIZED VIEW`. |

A table whose estimate is `0` shows the **Browse**, **Search** and **Empty** icons greyed, as phpMyAdmin does for empty tables. The links still work.

![The confirmation before Empty, with the TRUNCATE statement it runs](/media/schema/tables-empty-confirm.png)

::: warning Empty and Drop here have no CASCADE
The confirmation runs the plain statement. If another table has a foreign key to the one you empty, PostgreSQL refuses with *cannot truncate a table referenced in a foreign key constraint*; a drop fails when views or foreign keys depend on the table. To cascade, use the table's [Operations tab](/table/operations#emptying-and-dropping), which has **CASCADE** and **RESTART IDENTITY** boxes.
:::

## With selected

Tick rows (or **Check all**) and pick an action from **With selected:**.

![The Check all box and the With selected menu](/media/schema/tables-with-selected.png)

| Action | What it does |
| --- | --- |
| **Show create** | Opens a dialog with the `CREATE` statements of the selected tables, views and materialized views, the same DDL as each one's [Show create](/table/operations#show-create) tab. |
| **Export** | Opens the schema's [Export](/tools/export) tab with those relations pre-selected. |
| **Print** | Prints the page (the browser's print dialog; the action columns are hidden in print). |
| **Empty** | One confirmation for all, then a `TRUNCATE TABLE` per selected table. Views are skipped. |
| **Drop** | One confirmation listing every `DROP` statement, then runs them one by one. |
| **Analyze table** | Opens the SQL tab and runs `ANALYZE` on the selected tables. |
| **Vacuum table** | Opens the SQL tab and runs `VACUUM` on the selected tables. |

With nothing ticked, each action answers *No table selected.*

::: info How the bulk actions run
**Empty** and **Drop** run one statement at a time, not in a single transaction. If the third of five drops fails, the first two are already gone and the error is shown. **Analyze table** and **Vacuum table** only include tables: views and materialized views you ticked are left out of the statement.
:::

The **Print** link under the list prints the page as well.

## Creating a table

The **Create new table** card at the bottom asks for a **Table name** and the **Number of columns** (4 by default) and opens the create form with that many empty rows. See [Creating a table](/schema/create-table).

![The Create new table card: table name, number of columns, Create](/media/schema/tables-create-card.png)

When a schema has no relations, the page shows *No tables found in schema.* and the card.

## In the navigation tree

Under a schema, the tree groups objects in containers: **Tables**, **Statistics**, **Views**, **Materialized views**, **Sequences**, **Functions**, **Procedures**, **Trigger functions**, **Aggregates**, **Operators**, **Types**, **Domains**, **Collations** and the full text search objects. A table node opens its Browse tab; under it are its columns, indexes, constraints, partitions, triggers, rules and policies, each opening the page where that object is managed (Structure or Triggers).

## Coming from phpMyAdmin

| phpMyAdmin | Here |
| --- | --- |
| Database → Structure | Schema → Structure |
| **Engine**, **Collation**, **Overhead** columns | Not shown: PostgreSQL has no per-table engine (all tables use the `heap` access method), collation is per column, and dead space is a [VACUUM](/tools/maintenance) matter. |
| **Rows** exact for MyISAM, estimate for InnoDB | Always an estimate until you click it. |
| With selected → **Optimize**, **Repair**, **Check** | **Analyze table** and **Vacuum table**; the others have no PostgreSQL counterpart. |
| With selected → **Copy table with prefix**, **Replace table prefix** | Not available. Rename tables one at a time on [Operations](/table/operations#table-options). |
