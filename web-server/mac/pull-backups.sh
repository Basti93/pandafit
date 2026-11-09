#!/usr/bin/env bash
# Runs on the Mac: pulls the daily backups from the home server, so that one copy survives a broken disk.
# Pull rather than push: the server cannot delete the copies on the Mac. Same setup as in the other projects.
# Started by launchd (see install-pull.sh); an error shows a macOS notification. Keeps KEEP_DAYS days.
set -euo pipefail

SERVER="${BACKUP_SERVER:?BACKUP_SERVER setzen, z. B. nutzer@host}"
SOURCE="pandafit/backups/"
TARGET="${BACKUP_TARGET:-$HOME/Backups/pandafit}"
KEEP_DAYS="${KEEP_DAYS:-90}"
LOG="$TARGET/pull.log"

mkdir -p "$TARGET"

notify() {
  /usr/bin/osascript -e "display notification \"$1\" with title \"Pandafit-Backup\"" >/dev/null 2>&1 || true
}

fail() {
  echo "$(date '+%F %T') FAILED: $1" >> "$LOG"
  notify "Backup vom Server fehlgeschlagen: $1"
  exit 1
}

/usr/bin/rsync -a --timeout=120 -e "/usr/bin/ssh -o BatchMode=yes -o ConnectTimeout=20" \
  --include='pandafit-*.db.gz' --include='pandafit-coach-*.tar.gz' --exclude='*' "$SERVER:$SOURCE" "$TARGET/" 2>> "$LOG" \
  || fail "Server nicht erreichbar oder Kopieren gescheitert (Details: $LOG)"

newest=$(/bin/ls -t "$TARGET"/pandafit-*.db.gz 2>/dev/null | head -1 || true)
[ -n "$newest" ] || fail "keine Datenbanksicherung gefunden"
age_days=$(( ( $(date +%s) - $(stat -f %m "$newest") ) / 86400 ))
[ "$age_days" -le 2 ] || fail "neueste Datenbanksicherung ist $age_days Tage alt"

coach_newest=$(/bin/ls -t "$TARGET"/pandafit-coach-*.tar.gz 2>/dev/null | head -1 || true)
if [ -n "$coach_newest" ]; then
  coach_age=$(( ( $(date +%s) - $(stat -f %m "$coach_newest") ) / 86400 ))
  [ "$coach_age" -le 2 ] || fail "neueste Coach-Sicherung ist $coach_age Tage alt"
fi

# the server's configuration and credentials (paths relative to the home directory on the server), a new
# server cannot be set up without them; they never go into the repository. They are kept apart from the backups
# (SECRETS_DIR), so a copy of the backup folder never carries them. A changed file keeps its previous version
# with the time of the pull as suffix; these few small files are kept, KEEP_DAYS does not apply.
SECRETS="${SECRETS_DIR:-$HOME/.pandafit-secrets}"
umask 077
mkdir -p "$SECRETS" && chmod 700 "$SECRETS"
# Older versions put the copies below the backup folder; nothing is deleted here, the owner moves or removes them.
if [ ! -e "$SECRETS/.old-copies-warned" ] && [ -d "$TARGET/secrets" ] && [ -n "$(/bin/ls -A "$TARGET/secrets" 2>/dev/null)" ]; then
  echo "$(date '+%F %T') WARNUNG: alte Zugangsdaten-Kopien in $TARGET/secrets, bitte nach $SECRETS verschieben oder löschen" >> "$LOG"
  notify "Alte Zugangsdaten-Kopien liegen noch in $TARGET/secrets."
  : > "$SECRETS/.old-copies-warned"
fi
for file in ${SECRET_FILES:-pandafit/web-server/.env}; do
  /usr/bin/rsync -a --backup --suffix=".$(date +%F-%H%M%S)" --timeout=120 \
    -e "/usr/bin/ssh -o BatchMode=yes -o ConnectTimeout=20" "$SERVER:$file" "$SECRETS/" 2>> "$LOG" \
    || fail "Zugangsdatei $file nicht kopiert (Details: $LOG)"
done

find "$TARGET" -type f \( -name 'pandafit-*.db.gz' -o -name 'pandafit-coach-*.tar.gz' \) -mtime "+$KEEP_DAYS" -delete
echo "$(date '+%F %T') ok, newest $(basename "$newest"), $(du -sh "$TARGET" | cut -f1) in total" >> "$LOG"
