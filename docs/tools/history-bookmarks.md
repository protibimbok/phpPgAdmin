# History, bookmarks and macros

phpPgAdmin keeps three kinds of saved SQL for you: the **query history** (every statement you run),
**bookmarks** (queries saved under a label, per database, private or shared) and **macros** (queries
bound to a shortcut key). All three live in phpPgAdmin's own storage (the SQLite file under
`storage/`), not in the PostgreSQL server, and belong to the role you signed in as on that server.

| | Kept per | Where you see it | Who sees it |
| --- | --- | --- | --- |
| Query history | Role and server | The [console](/tools/console#history) | You |
| Bookmarks | Role, server and database | SQL tab's **Bookmarked SQL query** card, the console's **Bookmarks** card | You, or every role on the server when shared |
| Macros | Role and server (every database) | SQL tab's **Macros** menu, shortcut keys | You |

::: info For phpMyAdmin users
phpMyAdmin keeps bookmarks and history in its configuration storage database (`pma__bookmark`,
`pma__history`). phpPgAdmin needs no such database or tables in PostgreSQL; it uses its own SQLite
file. Saved items follow the server's host and port and the role name, so signing in as another role
shows other items, and a copy of phpPgAdmin on another machine starts empty.
:::

## Query history

Every statement sent to the server through the query runner is recorded with its database, the time
it started, how long it took, the rows it returned or changed, and whether it failed. That includes
the [SQL tab](/tools/sql), the [Browse](/table/browse) and [Search](/table/search) tabs (each page and
each re-sort of the grid is a new entry), the [database search](/database/search) Browse links, macros
and the console. Saves from the grid's inline editing and from the insert/edit form are not
recorded.

The console shows the newest 50 entries; see [Console → History](/tools/console#history) for how to
run, edit, explain or bookmark one.

### History length

**Settings → SQL queries → Query history length** sets how many entries are kept, from 1 to 500
(the default and the maximum). When a new statement is recorded, the oldest entries beyond the limit
are deleted.

::: warning Shortening the history deletes entries
Lowering the setting does not hide entries: at the next statement that runs, everything older than
the newest *N* is removed for good. Raising it again does not bring them back.
:::

### Clear the history

The console's **Clear** button deletes **all** your history entries on this server, not only the
ones the console shows. There is no way to delete a single entry.

## Bookmarks

A bookmark is a query saved under a label for one database.

### Bookmark a query

There are three places to save one:

**From the query box.** On the SQL tab of a database, schema or table, type a label in **Bookmark this
SQL query:** before you click **Go**. Two more boxes appear:

![The Bookmark this SQL query field with the label Top prices, and the Let every user access this bookmark and Replace existing bookmark of same name check boxes](/media/sql/bookmark-label.png)

| Field | What it does |
| --- | --- |
| **Bookmark this SQL query:** | The label. Labels do not have to be unique. |
| **Let every user access this bookmark** | Saves it as shared: every role on the server sees it. |
| **Replace existing bookmark of same name** | First deletes the bookmarks with this label in this database that are yours or shared. |

The bookmark is saved when you click **Go**, even if the query then fails.

**From a result.** Under every row-returning result on the SQL and Browse tabs, the
**Bookmark this SQL query** card has **Label:**, **Let every user access this bookmark** and a
**Bookmark this SQL query** button. It saves the statement as it was run (after
[bind parameters](/tools/sql#bind-parameters) were filled in), not the box's text.

**From the console.** **Bookmarks → Add** in the [console](/tools/console#bookmarks), or
**Bookmark** on a history entry, with a label, a target database and **Share this bookmark**.

### Run, view or delete a bookmark

On the SQL tab of a database (and its schemas and tables), the **Bookmarked SQL query** card lists the
bookmarks of that database, yours and the shared ones, which read *(shared)*. It appears once the
database has at least one.

![The Bookmarked SQL query card: the Bookmark select set to Stock by warehouse (shared), the Submit, View only and Delete radio buttons, and Go](/media/sql/bookmarked-card.png)

1. Pick the bookmark in **Bookmark:**.
2. Choose what **Go** does:
   - **Submit** puts the query in the box and runs it.
   - **View only** puts it in the box without running it.
   - **Delete** deletes the bookmark.
3. Click **Go**.

The console's **Bookmarks** card lists the bookmarks of every database and runs each in its own
database.

::: warning Shared bookmarks belong to everybody
A shared bookmark has no owner. Every role that signs in to the server can run it and **delete** it,
and **Replace existing bookmark of same name** replaces it. A bookmark cannot be changed from shared
to private or edited in place: delete it and save it again.
:::

::: info
phpMyAdmin's bookmark variables (`[VARIABLE1]` placeholders filled in when the bookmark runs) are
not supported. Use [Bind parameters](/tools/sql#bind-parameters) with **View only** instead.
:::

## Macros

A macro is a statement with a name and, optionally, a shortcut key, after pgAdmin's query tool
macros. Macros are yours across every database of the server; one runs in the database whose SQL tab
is open.

### The Macros menu

**Macros**, among the buttons under the SQL editor, opens a menu:

![The Macros menu: Manage macros, Add to macros, a divider, then Active sessions with the key Alt+F1 and Table sizes without a key](/media/sql/macros-menu.png)

| Item | What it does |
| --- | --- |
| **Manage macros** | Opens the dialog below. |
| **Add to macros** | Saves the query box's text as a new macro named **Macro 1**, **Macro 2**… (the next free number), without a key. |
| *A macro* | Runs it. Hover for its SQL. |

Running a macro does not change the query box. It uses the page's current **Delimiter**,
**Run as one transaction** and **Rollback when finished** options, and it does not ask for
[confirmation](/tools/sql#confirmation-of-destructive-statements), even for a `DROP`.

### Manage macros

![The Manage macros dialog: a row with the key Alt+F1, the name Active sessions and its SQL; a row for Table sizes with no key; Delete links, Add macro, and the note about keys the browser keeps](/media/sql/macros-dialog.png)

1. Open **Macros → Manage macros**.
2. Edit the rows: **Key** (or *(no key)*), **Name**, **SQL**. **Add macro** adds a row that starts with
   the query box's text; **Delete** removes a row.
3. Click **Save**. **Close** throws the changes away.

Each macro needs a name and a statement; names must be unique (ignoring case) and a key can be bound
to one macro only. A key already used by another row is greyed out in the list.

### Shortcut keys

The keys are pgAdmin's fixed set: <kbd>Ctrl</kbd>+<kbd>1</kbd>…<kbd>9</kbd>, <kbd>Ctrl</kbd>+<kbd>0</kbd>
and <kbd>Alt</kbd>+<kbd>F1</kbd>…<kbd>F12</kbd>. A key runs its macro anywhere on the SQL tab, also
while the editor has the focus. They do nothing on other pages.

::: warning Keys the browser or desktop keeps
Most browsers use <kbd>Ctrl</kbd>+<kbd>1</kbd>…<kbd>9</kbd> to switch tabs, and many desktops close
the window on <kbd>Alt</kbd>+<kbd>F4</kbd>; those keys never reach the page. <kbd>Ctrl</kbd>+<kbd>0</kbd>
(zoom reset) and some <kbd>Alt</kbd>+<kbd>F</kbd> keys may be taken too. Pick
<kbd>Alt</kbd>+<kbd>F1</kbd>…<kbd>F3</kbd> or <kbd>F5</kbd>…<kbd>F12</kbd> first, and run the others
from the menu.
:::
