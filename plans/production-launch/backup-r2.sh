#!/bin/bash
# Nightly encrypted dumps of Convex and every Postgres database to R2, as plain dated files.
# Installed as /usr/local/sbin/backup-r2.sh, run by backup-r2.timer. Settings: /etc/default/backup-r2.
# Sunday's copy goes to weekly/ and includes Convex's files. R2 expires daily/ after 14 days and
# weekly/ after 36, and its 7-day lock stops anyone deleting a recent copy, this server included.
# Restoring: see "Backups" in README.md. The private age key isn't on this server.
set -uo pipefail
set -a
. /etc/default/backup-r2
[ -f /etc/default/restic-backup ] && . /etc/default/restic-backup
set +a

# The time keeps a second run from overwriting locked files. `backup-r2.sh weekly` makes a weekly copy by hand.
STAMP=$(date -u +%F-%H%M)
if [ "${1:-}" = weekly ] || [ "$(date -u +%u)" = 7 ]; then PREFIX=weekly; FILES=(--include-file-storage); else PREFIX=daily; FILES=(); fi
DEST="r2:$BUCKET/$PREFIX/$STAMP"
WORK=/data/backups/r2-work
STATE=/var/lib/backup-r2
CONVEX_EXPORTS=/convex/data/storage/exports
FAILED=""

mkdir -p "$WORK" "$STATE"
trap 'rm -rf "$WORK"' EXIT

note() { echo "[$(date -u +%T)] $*"; }
failed() { FAILED+="$1"$'\n'; note "FAILED: $1"; }
# 128 MB parts allow an unknown-size stream up to 1.28 TB, R2's limit being 10,000 parts.
send() { age -r "$AGE_RECIPIENT" | rclone rcat -q --s3-chunk-size 128M --s3-upload-concurrency 4 "$DEST/$1.age"; }

backup_postgres() {
  local container=$1 user db
  user=$(docker exec "$container" printenv POSTGRES_USER)
  user=${user:-postgres}
  docker exec "$container" pg_dumpall -U "$user" --globals-only | zstd -q | send "postgres/$container/globals.sql.zst" \
    || failed "$container roles"
  local databases
  databases=$(docker exec "$container" psql -U "$user" -d postgres -Atc \
    "select datname from pg_database where not datistemplate order by 1") \
    || { failed "$container list of databases"; return; }
  for db in $databases; do
    note "postgres $container $db"
    docker exec "$container" pg_dump -U "$user" -Fc -Z0 "$db" | zstd -q -T4 -3 | send "postgres/$container/$db.dump.zst" \
      || failed "$container $db"
  done
}

backup_convex() {
  local backend=$1 key before after made
  key=$(docker exec "$backend" ./generate_admin_key.sh | tail -1) || { failed "$backend admin key"; return; }
  before=$(docker exec "$backend" ls "$CONVEX_EXPORTS") || { failed "$backend list of exports"; return; }
  note "convex $backend ${FILES[*]:-}"
  if docker run --rm --network "container:$backend" -v "$WORK:/out" \
    -e CONVEX_SELF_HOSTED_URL=http://127.0.0.1:3210 -e CONVEX_SELF_HOSTED_ADMIN_KEY="$key" \
    node:22-slim sh -c "cd /tmp && npm init -y >/dev/null && npm i --silent convex@latest && npx convex export --path /out/$backend.zip ${FILES[*]:-}"; then
    send "convex/$backend.zip" < "$WORK/$backend.zip" || failed "$backend upload"
  else
    failed "$backend export"
  fi
  rm -f "$WORK/$backend.zip"
  # Convex keeps every export in its volume for good, so remove the one this run made, and only that one.
  after=$(docker exec "$backend" ls "$CONVEX_EXPORTS") || { failed "$backend list of exports after"; return; }
  made=$(grep -vxF "$before" <<<"$after" || true)
  if [ -z "$made" ]; then return; fi
  if [ "$(wc -l <<<"$made")" != 1 ]; then failed "$backend: several new exports, none removed: $made"; return; fi
  docker exec "$backend" rm -f "$CONVEX_EXPORTS/$made" || failed "$backend export cleanup"
}

note "starting $DEST"
for container in $POSTGRES_CONTAINERS; do backup_postgres "$container"; done
for backend in $CONVEX_BACKENDS; do backup_convex "$backend"; done

# A copy far smaller than the last of its kind means a database or a dump went wrong without an error.
BYTES=$(rclone size -q --json "$DEST" | python3 -c 'import json,sys; print(json.load(sys.stdin)["bytes"])') || { BYTES=0; failed "reading the copy's size"; }
LAST=$(cat "$STATE/last-bytes-$PREFIX" 2>/dev/null || echo 0)
note "stored $BYTES bytes, last $PREFIX copy $LAST"
if [ "$BYTES" -le 0 ] || [ "$BYTES" -lt $((LAST / 2)) ]; then failed "only $BYTES bytes, the last $PREFIX copy had $LAST"; fi
if [ -z "$FAILED" ]; then echo "$BYTES" > "$STATE/last-bytes-$PREFIX" || failed "saving the copy's size"; fi

if [ -n "$FAILED" ]; then
  [ -n "${HEALTHCHECK_URL:-}" ] && curl -fsS -m 10 --retry 5 -o /dev/null --data-raw "backup-r2 failed: $FAILED" "$HEALTHCHECK_URL/fail"
  exit 1
fi
note "done"
