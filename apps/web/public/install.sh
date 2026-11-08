#!/bin/sh
# Installs the Aftercall test build (NEAR testnet) on a Mac, Apple silicon or Intel:
#   curl -fsSL https://getaftercall.vercel.app/install.sh | sh
#
# It downloads the same DMG as getaftercall.vercel.app/download, checks its SHA-256, copies
# Aftercall into /Applications (or ~/Applications) and opens it. A file fetched with curl isn't
# marked as downloaded, so macOS doesn't show its "could not verify" warning: you're trusting
# this script and this site instead of Apple's notarization, which this build doesn't have yet.
#
# When a new DMG is published, update DMG_SHA256 below with it.
# For testing: AFTERCALL_DEST=<folder> installs there, AFTERCALL_NO_OPEN=1 skips opening it.
set -eu

DMG_URL="https://getaftercall.vercel.app/releases/Aftercall-0.1.0-testnet.dmg"
DMG_SHA256="ed77768a6511ca9d1feb77fdfbe644b72a570ca25c03de522a8525d98128c854"
BUNDLE_ID="dev.aftercall.app"

say() { printf '%s\n' "$*"; }
fail() { printf 'Aftercall install: %s\n' "$*" >&2; exit 1; }

[ "$(uname -s)" = "Darwin" ] || fail "this is a Mac app."
os=$(sw_vers -productVersion)
major=${os%%.*}
rest=${os#*.}
minor=${rest%%.*}
[ "$rest" = "$os" ] && minor=0
if [ "$major" -lt 14 ] || { [ "$major" -eq 14 ] && [ "$minor" -lt 2 ]; }; then
  fail "it needs macOS 14.2 or later (this Mac has ${os})."
fi

work=$(mktemp -d)
mnt="$work/mnt"
cleanup() {
  [ -d "$mnt" ] && hdiutil detach -quiet "$mnt" 2>/dev/null || true
  rm -rf "$work"
}
trap cleanup EXIT INT TERM

say "Downloading Aftercall..."
curl -fL --progress-bar -o "${work}/Aftercall.dmg" "${DMG_URL}" || fail "the download failed."
got=$(shasum -a 256 "$work/Aftercall.dmg" | cut -d' ' -f1)
[ "${got}" = "${DMG_SHA256}" ] || fail "the download doesn't match the published build (got ${got}). Nothing was installed."

mkdir "$mnt"
hdiutil attach -quiet -nobrowse -readonly -mountpoint "${mnt}" "${work}/Aftercall.dmg" || fail "couldn't open the DMG."
[ -d "${mnt}/Aftercall.app" ] || fail "the DMG has no Aftercall.app."

dest="${AFTERCALL_DEST:-/Applications}"
[ -w "$dest" ] || { dest="$HOME/Applications"; mkdir -p "$dest"; }
app="$dest/Aftercall.app"

if [ -e "$app" ]; then
  # Only ever replace an earlier Aftercall, never anything else at that path.
  existing=$(defaults read "$app/Contents/Info" CFBundleIdentifier 2>/dev/null || true)
  [ "${existing}" = "${BUNDLE_ID}" ] || fail "${app} exists and isn't Aftercall. Move it, then run this again."
  # Never quit it for you: a recording may be running.
  pgrep -f "${app}/Contents/MacOS/" >/dev/null && fail "Aftercall is open. Quit it (Cmd-Q), then run this again."
  rm -rf "$app"
fi

say "Installing to ${dest}..."
ditto "$mnt/Aftercall.app" "$app"
[ "${AFTERCALL_NO_OPEN:-}" = 1 ] && { say "Installed ${app}."; exit 0; }
say "Opening Aftercall. Your notes, keys and wallet stay on this Mac."
open "$app"
