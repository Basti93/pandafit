#!/bin/bash
# Renders the full-bleed web icon src/web/public/icons/icon.svg to the PNG sizes the web app needs. macOS only (qlmanage and sips).
set -euo pipefail
cd "$(dirname "$0")/.."
dir=src/web/public/icons
tmp=$(mktemp -d)
qlmanage -t -s 512 -o "$tmp" "$dir/icon.svg" >/dev/null 2>&1
src="$tmp/icon.svg.png"
sips -z 512 512 "$src" --out "$dir/icon-512.png" >/dev/null
sips -z 192 192 "$src" --out "$dir/icon-192.png" >/dev/null
sips -z 180 180 "$src" --out "$dir/apple-touch-icon.png" >/dev/null
sips -z 32 32 "$src" --out "$dir/favicon-32.png" >/dev/null
rm -rf "$tmp"
echo "icons written to $dir"
