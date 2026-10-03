#!/usr/bin/env bash
#
# Run every suite in this directory.
#
# These used to live in the session scratchpad, where a container rebuild
# deleted the lot — five suites and the evidence behind five fixes, gone
# with nothing in the repo to show they had ever existed. They live here
# now so they survive the machine they were written on.
#
# What they need:
#   npm ci && npm run build          — they import from dist/, not src/
#   a MySQL/MariaDB on 127.0.0.1     — user ci / password ci / database cityink
#   group_concat_max_len = 1024      — Railway's MySQL default. A sandbox
#                                      MariaDB ships 1MB, which hides a whole
#                                      class of bug; pin it or the suites that
#                                      care prove nothing.
#
# Override the database with DATABASE_URL if yours is elsewhere.
#
# Not every .mjs that ever sat beside these was a suite — stand-in servers
# meant to stay running, hand-driven probes, screenshot scripts. If you add
# one of those, add it to SKIP below, or a clean run reports failures that
# are not failures.
set -uo pipefail

cd "$(dirname "$0")"

SKIP=()

pass=0
fail=0
failed=()

for f in *.mjs; do
  [ -e "$f" ] || continue
  for s in ${SKIP[@]+"${SKIP[@]}"}; do
    [ "$f" = "$s" ] && continue 2
  done

  printf '\n=== %s ===\n' "$f"
  if node "$f"; then
    pass=$((pass + 1))
  else
    fail=$((fail + 1))
    failed+=("$f")
  fi
done

printf '\n%s\n' "----------------------------------------"
printf '%d suite(s) passed, %d failed\n' "$pass" "$fail"
for f in ${failed[@]+"${failed[@]}"}; do
  printf '  failed: %s\n' "$f"
done

[ "$fail" -eq 0 ]
