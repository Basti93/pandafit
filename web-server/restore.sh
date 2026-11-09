#!/bin/sh
# pandafit: puts backups of backup.sh and backup-coach.sh back into the volumes data (api) and coach.
#   ./restore.sh ../backups/pandafit-<time>.db.gz [../backups/pandafit-coach-<time>.tar.gz]
# On a new server: .env in place (Mac copy in ~/.pandafit-secrets), `docker compose up -d`, then this script.
# A volume with data (accounts) is only replaced with FORCE=1; it is copied first, stopped, into
# ../backups/pre-restore-<time>-api.tar (database with -wal and -shm) and -coach.tar, and nothing is removed when a
# copy fails. The containers run without capabilities: the copies leave as tar on stdout, written by the host. The coach keeps its home/ (the Claude login), which the backup leaves out.
# No pipelines between docker and files: dash has no pipefail, so every step is a file whose exit status counts.
set -eu
umask 077
cd "$(dirname "$0")"
db="${1:?usage: ./restore.sh <pandafit-*.db.gz> [<pandafit-coach-*.tar.gz>]}"
coach="${2:-}"
backups="$(cd ../backups 2>/dev/null && pwd -P || { mkdir -p ../backups && cd ../backups && pwd -P; })"
stopped=0
# after the stop and before anything was replaced, a failure starts the services again
die() { echo "restore: $*" >&2; [ "$stopped" = 0 ] || docker compose start api coach >/dev/null 2>&1 || true; exit 1; }
run() { docker compose run --rm --no-deps -T "$@"; }
gzip -t "$db"
[ -z "$coach" ] || gzip -t "$coach"
tmp=$(mktemp); tmp_coach=$(mktemp)
trap 'rm -f "$tmp" "$tmp_coach"' EXIT

# exit 0: data present, 3: empty (a new volume), anything else: stop
state() {
  s=0
  case "$1" in
    api) run --entrypoint node api -e "
      const fs = require('node:fs');
      if (!fs.existsSync('/data/pandafit.db')) process.exit(3);
      const { DatabaseSync } = require('node:sqlite');
      const n = new DatabaseSync('/data/pandafit.db', { readOnly: true }).prepare('SELECT count(*) AS n FROM accounts').get().n;
      process.exit(n > 0 ? 0 : 3);" || s=$? ;;
    coach) run --entrypoint sh coach -c '[ -d /data/accounts ] && [ -n "$(ls -A /data/accounts)" ] && exit 0; exit 3' || s=$? ;;
  esac
  echo "$s"
}
api_state=$(state api)
coach_state=3; [ -z "$coach" ] || coach_state=$(state coach)
for s in "$api_state" "$coach_state"; do
  case "$s" in 0|3) ;; *) die "cannot read a current volume (exit $s); nothing was replaced" ;; esac
done
if [ "$api_state" = 0 ] || [ "$coach_state" = 0 ]; then
  [ "${FORCE:-}" = 1 ] || die "a volume holds data; FORCE=1 replaces it (after a copy)"
fi

docker compose stop api coach
stopped=1
safety="$backups/pre-restore-$(date +%Y%m%d-%H%M%S)"
if [ "$api_state" = 0 ]; then
  # a stop does not checkpoint the WAL: the copy takes -wal and -shm along
  run --entrypoint sh api -ec 'cd /data && tar -cf - $(ls pandafit.db pandafit.db-wal pandafit.db-shm 2>/dev/null)' > "$safety-api.tar" \
    && tar -tf "$safety-api.tar" | grep -qx pandafit.db || die "copy of the database failed; nothing was replaced"
  echo "current database saved to $safety-api.tar"
fi
if [ "$coach_state" = 0 ]; then
  # as sensitive as the nightly backup: without home/ (Claude login, kept in place anyway) and work/
  run --entrypoint sh coach -ec 'tar -cf - --exclude=./home --exclude=./work --exclude=./.backup-staging -C /data .' > "$safety-coach.tar" \
    && tar -tf "$safety-coach.tar" | grep -q '^\./accounts/' || die "copy of the coach volume failed; nothing was replaced"
  echo "current coach volume saved to $safety-coach.tar"
fi

# a volume made before the image may belong to root (README); the backups arrive on stdin, readable by node
[ "$(run --entrypoint stat api -c %U /data)" = node ] || run --user root --cap-add CHOWN --entrypoint chown api -R node:node /data
gunzip -c "$db" > "$tmp"
[ -z "$coach" ] || { gunzip -c "$coach" > "$tmp_coach"; tar -tf "$tmp_coach" | grep -q '^\./accounts/' || die "$coach holds no accounts"; }
# checked as a file next to the database before it replaces it
run --entrypoint sh api -ec 'umask 077 && cat > /data/.restore.tmp' < "$tmp" || die "writing the database failed"
run --entrypoint node api -e "
  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync('/data/.restore.tmp', { readOnly: true });
  if (db.prepare('PRAGMA integrity_check').get().integrity_check !== 'ok') { console.error('integrity check failed'); process.exit(1); }
  console.log('accounts', db.prepare('SELECT count(*) AS n FROM accounts').get().n);" || die "$db fails its integrity check"
stopped=0
run --entrypoint sh api -ec 'rm -f /data/pandafit.db-wal /data/pandafit.db-shm && mv /data/.restore.tmp /data/pandafit.db'
if [ -n "$coach" ]; then
  run --entrypoint sh coach -ec 'umask 077 && cd /data && find . -mindepth 1 -maxdepth 1 ! -name home -exec rm -rf {} + && tar -xf -' < "$tmp_coach" \
    || die "writing the coach volume failed"
  run --entrypoint sh coach -c 'cd /data; find accounts -type f -name "*.db" | node -e "
    const { DatabaseSync } = require(\"node:sqlite\"); const fs = require(\"node:fs\");
    for (const f of fs.readFileSync(0, \"utf8\").split(\"\\n\").filter(Boolean))
      if (new DatabaseSync(f, { readOnly: true }).prepare(\"PRAGMA integrity_check\").get().integrity_check !== \"ok\") { console.error(\"integrity check failed: \" + f); process.exit(1); }
    console.log(\"coach accounts\", fs.readdirSync(\"accounts\").length);"'
fi

docker compose up -d api coach
for _ in $(seq 1 30); do
  st="$(docker compose ps api coach --format '{{.Status}}')"
  case "$st" in *unhealthy*) die "unhealthy: $st" ;; esac
  [ "$(printf '%s\n' "$st" | grep -c '(healthy)')" = 2 ] && { echo "restored from $db${coach:+ and $coach}, api and coach healthy"; exit 0; }
  sleep 2
done
die "api and coach not healthy after 60 s"
