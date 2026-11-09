#!/usr/bin/env bash
# Ad hoc signs the built app (Apple chips refuse to start anything otherwise) and moves it to /Applications.
# Aborts while a ride is open: replacing the app would hit the running service.
set -euo pipefail
cd "$(dirname "$0")/.."
SRC="release/mac-arm64/Pandafit.app"
DEST="/Applications/Pandafit.app"
LIVE_STATE=$(node -e "
const fs=require('fs'),os=require('os'),path=require('path');const W=require('ws');
let t='';try{t=fs.readFileSync(path.join(os.homedir(),'Library','Application Support','bike-coach','local-token'),'utf8').trim()}catch{}
const w=new W('ws://127.0.0.1:'+(process.env.PANDAFIT_SERVICE_PORT||7410)+'/?t='+t);
w.on('message',d=>{const m=JSON.parse(d);if(m.type==='state'){console.log(m.ride?'open':'none');process.exit(0)}});
w.on('error',()=>{console.log('none');process.exit(0)});setTimeout(()=>{console.log('none');process.exit(0)},4000);" 2>/dev/null || echo none)
if [ "$LIVE_STATE" = "open" ]; then echo "Fahrt offen, nichts installiert."; exit 1; fi
codesign --force --deep --sign - "$SRC"
codesign --verify --deep "$SRC"
rm -rf "$DEST"
cp -R "$SRC" "$DEST"
echo "Installiert: $DEST"
