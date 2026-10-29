# Signing in

You sign in to phpPgAdmin with a PostgreSQL role and its password, as you sign in to phpMyAdmin with a MySQL account. This page covers the login form, saved servers, the Advanced section, the language picker, the errors you can get, and how sessions and passwords are handled.

![The login page: the phpPgAdmin logo, a Language card with a select, and a Log in card with Username, Password, Server choice and an Advanced link](/media/guide/login.png)

## Logging in

1. Open phpPgAdmin. Any address works: if you are not signed in, the login page appears in its place, and after signing in you land on the page you asked for.
2. Enter a PostgreSQL role in **Username:** and its password in **Password:**. Leave the password empty if the server lets the role in without one (`trust` or `peer` authentication in `pg_hba.conf`).
3. Pick the server in **Server choice:**, or open **Advanced** to enter another one.
4. Click **Log in**. The button stays disabled while the connection is being made.

phpPgAdmin then connects as that role. There are no separate phpPgAdmin accounts: what you can see and change is what PostgreSQL allows the role, so a role without `CREATEDB` gets an error from PostgreSQL when it creates a database, and a non-superuser sees no other users' query text on the Status pages.

The role needs the `LOGIN` attribute and the `CONNECT` privilege on at least one of the databases a login tries (see [Maintenance database](#advanced)).

## Saved servers

Every server a login succeeds against is saved in phpPgAdmin's storage and offered under **Server choice:** next time, the most recently used first, with the role that used it last filled in as the username. Choosing another saved server fills in its role the same way, unless you have typed a username yourself, which is kept. **Other server…** at the end of the list resets the Advanced fields to the [configured default server](/guide/configuration#default-server).

**Server choice:** only appears once at least one server has been saved. Before that, the form signs in to the default server, or to what you enter under Advanced.

A saved server is identified by its host and port. Signing in to it again with a different SSL mode or maintenance database updates the saved entry. A failed login saves nothing.

::: warning Saved servers are shared and visible before sign-in
Saved servers belong to the installation, not to a person. Everyone who opens the login page sees the same list, including the last username used on each server, and the list is also available without signing in at `/api/auth/servers`. No passwords are saved.
:::

::: info Same server, different entries
`localhost:5432` and `127.0.0.1:5432` are two saved servers, and your [settings](/server/settings), history and bookmarks are kept separately for each, because they are stored by host and port as typed.
:::

### Renaming and removing saved servers

The interface has no page for this. The servers are rows of the `servers` table in the storage database (`storage/phppgadmin.sqlite` unless [`PGADMIN_STORAGE_PATH`](/guide/configuration#storage) says otherwise), and you can change them with the `sqlite3` command:

```sh
sqlite3 storage/phppgadmin.sqlite "SELECT id, name, host, port, sslmode, maintenance_db, last_username FROM servers"

# Show a name in the list: "Production (db1.internal:5432)"
sqlite3 storage/phppgadmin.sqlite "UPDATE servers SET name = 'Production' WHERE id = 3"

# Remove one
sqlite3 storage/phppgadmin.sqlite "DELETE FROM servers WHERE id = 3"
```

If a server is removed while the login page is open and you log in with it selected, the form says "That saved server no longer exists." Reload the page.

## Advanced

Click **Advanced** to enter a server by hand. The fields start with the selected server's values.

![The Log in card with Advanced open: Host, Port, SSL mode and Maintenance database fields under the server choice](/media/guide/login-advanced.png)

| Field | What to enter |
|---|---|
| **Host:** | A host name, an IP address, or the directory of the server's Unix socket, such as `/var/run/postgresql`. With a socket directory, the server home page says "via UNIX socket". |
| **Port:** | The TCP port, 1 to 65535; for a socket, the number in the socket file's name (`.s.PGSQL.5432`). |
| **SSL mode:** | libpq's `sslmode`: `disable`, `allow`, `prefer` (default), `require`, `verify-ca`, `verify-full`. Ignored for a Unix socket. The home page's **Server connection:** line shows whether SSL is used. |
| **Maintenance database:** | The database to connect to first. Empty means `postgres`, then `template1`, then the database named after the role, whichever lets the role in first. The databases are listed from this connection. |

If the fields still match the selected saved server, the login uses that saved server. If you changed any of them, the login goes to the server they describe, and that server is saved on success.

::: info A maintenance database that does not exist
If the maintenance database you enter does not exist, the login falls back to `postgres`, `template1` and the role's database, and succeeds if one of them lets the role in. The name you entered is still saved with the server.
:::

## Language

The **Language** card above the form switches the interface language at once; English and Arabic (right-to-left) are available. The choice is kept in your browser session and in a `pga_lang` cookie for a year, so the login page opens in the same language next time.

Once you sign in, the language your role chose last time (on this server) takes over. Changing the language while signed in, on the server home page, saves it for the role. See [Language and right-to-left](/guide/interface#language-and-right-to-left).

## When the login fails

The error appears in a red box above the form. Except for an empty username, it is the message libpq or the server returned, so it names the exact cause:

![A red error box: connection to server at "localhost" (::1), port 5499 failed: FATAL: role "nobody_here" does not exist](/media/guide/login-error.png)

| Situation | Message (as observed) |
|---|---|
| No username | A username is required. |
| Wrong password | connection to server at "localhost" (::1), port 5499 failed: FATAL: password authentication failed for user "…" |
| Unknown role | … FATAL: role "…" does not exist |
| Role without `LOGIN` | … FATAL: role "…" is not permitted to log in |
| Nothing listening on that port | … Connection refused. Is the server running on that host and accepting TCP/IP connections? (once per address the host name resolves to) |
| Unknown host name | could not translate host name "…" to address: Name or service not known |
| Host that does not answer | connection to server at "…", port … failed: timeout expired, after [`PGADMIN_DB_TIMEOUT`](/guide/configuration#environment-variables) seconds (10 by default) |
| Wrong socket directory | connection to server on socket "/run/postgresql/.s.PGSQL.5499" failed: No such file or directory |
| `require` against a server without SSL | … server does not support SSL, but SSL was required |
| Empty host | A server needs a host. |
| Storage not writable | Internal Server Error (see [Writable storage](/guide/installation#writable-storage)) |

Connection failures other than rejected credentials (unreachable servers, timeouts) are also written to the PHP error log as `phpPgAdmin: cannot connect to host:port: …`.

::: tip Password authentication and pg_hba.conf
"password authentication failed" can also mean the client address matched a `pg_hba.conf` line with a different method than you expected. The web server connects from its own address, not from your browser's: `localhost` may resolve to `::1` first, as in the messages above.
:::

## Logging out

Use **Log out** in the navigation panel's header (the door icon next to **Home**), or in the user menu at the top end corner of the page. The session forgets the role, its password and the server, the session id is replaced, and the login page appears. Your language choice stays.

![The user menu open: postgres@localhost, phpPgAdmin documentation, PostgreSQL documentation and Log out](/media/guide/user-menu.png)

## Passwords and sessions

- **The password is kept in the PHP session while you are signed in**, on the web server, so that each request can open connections as your role. It is never written to phpPgAdmin's storage database, and it is passed to `pg_dump`, `psql` and `pg_restore` in the `PGPASSWORD` environment variable rather than on their command line. Logging out removes it from the session.
- **Sessions are PHP's own.** phpPgAdmin uses PHP's session cookie (`PHPSESSID`) and PHP's session storage, with PHP's settings. It sets no lifetime of its own: a session ends when the browser is closed (the cookie has no expiry) or when PHP's session garbage collection removes it after `session.gc_maxlifetime` seconds of inactivity (1440, 24 minutes, by default).
- **A new session id at login and logout,** so a session id obtained before signing in cannot be used to take over the signed-in session.
- **Several tabs share one session.** Signing in to another server in one tab signs every tab of that browser in to it.

::: warning Protect the session store
Because sessions hold passwords, anyone who can read PHP's session files can read them. Keep `session.save_path` private to the PHP user, and set `session.cookie_httponly = 1` (and `session.cookie_secure = 1` on HTTPS): with PHP's defaults the `PHPSESSID` cookie is readable by JavaScript. See [PHP settings that matter](/guide/configuration#php-settings-that-matter).
:::

### When the session expires

phpPgAdmin notices an expired session at the next request. The page you are on stays open until then; the next action that loads data brings up the login form, with **Your session has expired. Please log in again.** above it, at the same address. After signing in you are back on the page you were on, as when you open a bookmarked address while signed out. Changes you had not yet sent from a form on that page are lost.
