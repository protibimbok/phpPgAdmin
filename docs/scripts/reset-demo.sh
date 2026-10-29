#!/usr/bin/env bash
# Rebuilds the "bookshop" demo database the documentation screenshots are taken from.
# PGHOST / PGPORT / PGUSER are honoured; the defaults are the docs cluster (demo-cluster.sh, localhost:5499).
set -euo pipefail
cd "$(dirname "$0")/.."
export PGUSER="${PGUSER:-postgres}" PGHOST="${PGHOST:-localhost}" PGPORT="${PGPORT:-5499}"
psql -X -q -d postgres -c 'DROP DATABASE IF EXISTS bookshop WITH (FORCE)' -c 'CREATE DATABASE bookshop'
psql -X -q -v ON_ERROR_STOP=1 -d bookshop -f demo/seed.sql
echo "bookshop ready"
