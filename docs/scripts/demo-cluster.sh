#!/usr/bin/env bash
# Starts a throwaway PostgreSQL cluster for the documentation captures, so screenshots show only
# the demo database and walkthroughs can create, alter and drop freely.
#
#   docs/scripts/demo-cluster.sh start    # initdb on first run, then start; seeds "bookshop"
#   docs/scripts/demo-cluster.sh stop
#
# DOCS_PG_DATA (default ~/.cache/phppgadmin-docs/pgdata) and DOCS_PG_PORT (default 5499).
# The cluster preloads the debugger plugin, writes server logs and runs wal_level=logical so
# the Debugger, Logs and Replication pages have something to show.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
data="${DOCS_PG_DATA:-$HOME/.cache/phppgadmin-docs/pgdata}"
port="${DOCS_PG_PORT:-5499}"

case "${1:-start}" in
  start)
    if [ ! -f "$data/PG_VERSION" ]; then
      mkdir -p "$data"
      initdb -D "$data" -U postgres --auth=trust --encoding=UTF8 --locale=C.UTF-8 >/dev/null
      cat >> "$data/postgresql.conf" <<CONF
port = $port
listen_addresses = 'localhost'
unix_socket_directories = '$data'
shared_preload_libraries = 'plugin_debugger'
wal_level = logical
logging_collector = on
log_destination = 'stderr,csvlog,jsonlog'
log_min_duration_statement = 0
track_functions = all
CONF
      fresh=1
    fi
    pg_ctl -D "$data" -l "$data/startup.log" -w status >/dev/null 2>&1 || pg_ctl -D "$data" -l "$data/startup.log" -w start >/dev/null
    if [ -n "${fresh:-}" ]; then
      PGHOST=localhost PGPORT=$port "$here/reset-demo.sh"
      PGHOST=localhost PGPORT=$port psql -X -q -U postgres -d bookshop -c 'CREATE EXTENSION IF NOT EXISTS pldbgapi'
    fi
    echo "docs cluster on localhost:$port ($data)"
    ;;
  stop)
    pg_ctl -D "$data" -w stop
    ;;
  *)
    echo "usage: $0 start|stop" >&2; exit 2 ;;
esac
