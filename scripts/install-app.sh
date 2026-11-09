#!/usr/bin/env bash
# Ad hoc signs the built app (Apple chips refuse to start anything otherwise) and moves it to /Applications.
# Aborts while a ride is open: replacing the app would hit the running service.
set -euo pipefail
cd "$(dirname "$0")/.."
SRC="release/mac-arm64/Pandafit.app"
DEST="/Applications/Pandafit.app"
DATA="${BIKE_DATA_DIR:-$HOME/Library/Application Support/bike-coach/rides}"
# Answers: open | none | refused (service not running) | error:<reason>. Only a clean "none" or "refused" may go on.
LIVE_STATE=$(node -e "
const fs=require('fs'),os=require('os'),path=require('path');const W=require('ws');
const out=(s)=>{console.log(s);process.exit(0)};
let t='';try{t=fs.readFileSync(path.join(os.homedir(),'Library','Application Support','bike-coach','local-token'),'utf8').trim()}catch{out('error:token')}
if(!t)out('error:token');
const w=new W('ws://127.0.0.1:'+(process.env.PANDAFIT_SERVICE_PORT||7410)+'/?t='+t);
w.on('message',d=>{try{const m=JSON.parse(d);if(m.type==='state')out(m.ride?'open':'none')}catch{out('error:answer')}});
w.on('unexpected-response',(_q,r)=>out('error:http-'+r.statusCode));
w.on('error',e=>out(e&&e.code==='ECONNREFUSED'?'refused':'error:connection'));
w.on('close',()=>out('error:closed'));
setTimeout(()=>out('error:timeout'),4000);" 2>/dev/null || echo "error:node")
case "$LIVE_STATE" in
  none) ;;
  open) echo "Fahrt offen, nichts installiert."; exit 1 ;;
  refused)
    # Service not running: look at the rides on disk, as a ride may be open without it.
    if grep -qs '"status":"open"' "$DATA"/ride-*/meta.json; then echo "Offene Fahrt gefunden (meta.json), nichts installiert."; exit 1; fi ;;
  *) echo "Der Fahrt-Dienst gab keine eindeutige Antwort ($LIVE_STATE), nichts installiert."; exit 1 ;;
esac
codesign --force --deep --sign - "$SRC"
codesign --verify --deep "$SRC"
rm -rf "$DEST"
cp -R "$SRC" "$DEST"
echo "Installiert: $DEST"
