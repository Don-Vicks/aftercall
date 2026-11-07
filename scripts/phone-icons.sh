#!/usr/bin/env bash
# Draws the phone page's home-screen icons from the app icon (./scripts/phone-icons.sh).
#
# Source: apps/desktop/src-tauri/icons/source/app-icon.svg, the same artwork as the Mac app.
# Out, in apps/web/public/phone-icons/:
#   icon-192.png, icon-512.png   the manifest's icons, as the Mac shows it (macOS grid margin, clear corners)
#   apple-touch-icon.png         180 px, for Add to Home Screen on iOS: the icon's body edge to edge
#                                on its own dark ground, since iOS fills clear pixels with black and
#                                rounds the corners itself
# Uses sips, which comes with macOS.
set -euo pipefail
cd "$(dirname "$0")/.."

SRC=apps/desktop/src-tauri/icons/source/app-icon.svg
OUT=apps/web/public/phone-icons
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
mkdir -p "$OUT"

sips -s format png "$SRC" --out "$TMP/icon.png" >/dev/null
sips -z 192 192 "$TMP/icon.png" --out "$OUT/icon-192.png" >/dev/null
sips -z 512 512 "$TMP/icon.png" --out "$OUT/icon-512.png" >/dev/null

# The body is the 824 px square at (100, 100) on the 1024 px canvas; its ground is #1b1a17.
sed -e 's|width="1024" height="1024" viewBox="0 0 1024 1024">|width="824" height="824" viewBox="100 100 824 824"><rect x="100" y="100" width="824" height="824" fill="#1b1a17"/>|' "$SRC" >"$TMP/full.svg"
grep -q 'viewBox="100 100 824 824"' "$TMP/full.svg" || { echo "app-icon.svg's canvas changed; update this script" >&2; exit 1; }
sips -s format png "$TMP/full.svg" --out "$TMP/full.png" >/dev/null
sips -z 180 180 "$TMP/full.png" --out "$OUT/apple-touch-icon.png" >/dev/null

echo "Wrote $OUT/icon-192.png, icon-512.png and apple-touch-icon.png"
