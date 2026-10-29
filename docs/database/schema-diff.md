# Schema diff

The **Schema diff** tab of a database (`/db/<database>/schema-diff`) compares two schemas, after
pgAdmin's Schema Diff tool: every object of both is listed as identical, different, only in the source or
only in the target, each with its DDL on both sides, and the objects you tick make a script that turns
the target into the source. The two schemas can be in the same database or in two databases of the
server.

The examples compare `inventory` (the source) with `inventory_next` (the target) in bookshop, which the
demo seed created with drift: `inventory_next.warehouses` has an extra `capacity` column and `code` is
`varchar(8)`, `stock` lacks the foreign key to `public.books` and has a `CHECK`, `promotions` is missing,
and there is an extra `suppliers` table.

## Comparing

![The Source and Target cards, with the options and Compare](/media/database/schema-diff-form.png)

1. In **Source**, pick the **Database** and **Schema** you want the target to look like.
2. In **Target**, pick the database and schema to change. Both sides start on the current database and
   its `public` schema.
3. Tick what to ignore under **Options**, and click **Compare**.

| Option | Ignores |
| --- | --- |
| **Ignore owner** | `ALTER … OWNER TO` |
| **Ignore whitespace** | differences in spaces and line breaks |
| **Ignore tablespace** | tablespace clauses |
| **Ignore grants/revokes** | `GRANT` and `REVOKE` |

Comparing a schema with itself is refused (*The source and the target are the same schema.*). Object
names are compared without their schema, so `inventory.stock` and `inventory_next.stock` are the same
object.

## Results

![The results: two sequences and four tables, coloured by status](/media/database/schema-diff-results.png)

The objects are grouped by type and coloured like pgAdmin's: **Different** yellow, **Source only** green,
**Target only** red. The boxes above the list filter by status and show the counts; **Identical** objects
are hidden at first.

Click an object to see its DDL in three panes: **Source**, **Target**, and **Difference**, the statements
that would make the target's object like the source's.

![The Source pane: inventory.warehouses as its SQL tab writes it](/media/database/schema-diff-source-ddl.png)

![The Difference pane of warehouses: drop capacity, retype code](/media/database/schema-diff-ddl.png)

How each kind of difference is written:

| Status | Statements |
| --- | --- |
| Source only | the source's `CREATE`, written in the target schema |
| Target only | `DROP … IF EXISTS` |
| Different table | `ALTER TABLE`: columns added, dropped, retyped (`TYPE … USING col::type`), defaults, `NOT NULL`, identity, comments; constraints, indexes and triggers dropped and made again where they differ; the owner and grants the source sets, and revokes for grants only the target has |
| Different sequence | `ALTER SEQUENCE` for the increment, bounds, start, cache and cycle |
| Different routine or view | `CREATE OR REPLACE` |
| Anything else that differs | `DROP` and `CREATE` again |

::: info What a table's diff leaves to you
Rules, policies and storage parameters of a table are not altered; when they differ, the difference
names them in a comment for you to settle. A generated column whose expression changed is dropped and
added again, which loses its values only to recompute them.
:::

## The script

Every object that is not identical starts ticked. Untick what you want to leave alone and click
**Generate script**:

![The generated script in its dialog](/media/database/schema-diff-script.png)

The script is wrapped in `BEGIN;` … `END;`. The drops of what is only in the target come first, in the
reverse of the creation order; then the rest in creation order: collations, types, domains, text search
objects, sequences, functions, procedures, trigger functions, aggregates, operators, tables (each after
the tables its foreign keys reference), foreign tables, views and materialized views.

**Open in the SQL page of bookshop** puts the script into the target database's
[SQL page](/tools/sql) query box. It is not run: read it, and click **Go** there when you are sure.

A table only in the source is made with its sequences in order: the sequence is created first, the
table's `serial` column is written as its type with a `DEFAULT nextval(…)` of that sequence (a `serial`
would make a second sequence, `promotions_id_seq1`), and the `ALTER SEQUENCE … OWNED BY` that ties the
sequence to the column comes at the end of the script, once the table exists. If you untick the
sequence and the target has none, the column stays `serial` and `CREATE TABLE` makes it.

Privileges end up as the source has them. For a table or sequence that differs, the script first
revokes each grant only the target has (`REVOKE SELECT, UPDATE ON TABLE inventory.stock FROM
bookshop_staff;`), privilege for privilege and column grants included, then makes the source's grants.
With **Ignore grants/revokes** ticked, neither is in the script.

::: warning Unqualified references
A foreign key added by the script is written as the catalog prints it, for example
`REFERENCES books(id)` for `public.books`: it depends on the `search_path` of the session that runs the
script. On the SQL page `public` is on the path; check the script if you run it elsewhere.
:::

::: tip Try it on copies
To see a script applied without touching the real schemas, copy them first: for example
`pg_dump -s -d bookshop | psql -d scratch` and compare the two schemas in `scratch`. That is how the
script above was checked: it ran clean, and a new comparison showed every object identical. The other
way round (`inventory_next` into a copy of `inventory`) runs clean too, and leaves only `stock`'s extra
grants.
:::

## What is compared

Objects inside the two schemas: collations, types, domains, the four kinds of full text search objects,
sequences, functions, procedures, trigger functions, aggregates, operators, tables (with their columns,
constraints, indexes, triggers and comment), foreign tables, views and materialized views.

Not compared:

- database-level objects: extensions, event triggers, publications, subscriptions, foreign data wrappers
  and servers, casts, languages, and the database's own settings;
- roles and tablespaces, which belong to the server;
- data;
- schemas of two different servers: both sides must be on the server you are signed in to.
