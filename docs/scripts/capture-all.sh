#!/usr/bin/env bash
# Regenerates every screenshot and clip: rebuilds the docs cluster from scratch, then runs each
# capture script in docs/scripts/captures/ one after another (they share the cluster, so never in
# parallel). Needs the app at DOCS_APP_URL (default http://phppgadmin.test) and ffmpeg.
# Pass script names to run only those: docs/scripts/capture-all.sh sql table
set -uo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
data="${DOCS_PG_DATA:-$HOME/.cache/phppgadmin-docs/pgdata}"

if [ "${KEEP_CLUSTER:-}" != 1 ]; then
  "$here/demo-cluster.sh" stop >/dev/null 2>&1 || true
  rm -rf "$data"
  "$here/demo-cluster.sh" start
fi

failed=()
for f in "$here"/captures/*.mjs; do
  name="$(basename "$f" .mjs)"
  case "$name" in *-lib|*-common) continue ;; esac
  if [ $# -gt 0 ] && ! printf '%s\n' "$@" | grep -qx "${name%%-*}\|$name"; then continue; fi
  echo "== $name"
  node "$f" || failed+=("$name")
done

if [ ${#failed[@]} -gt 0 ]; then echo "failed: ${failed[*]}"; exit 1; fi
echo "all captures done"
