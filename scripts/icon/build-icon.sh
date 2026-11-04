#!/usr/bin/env bash
# Build the app icon from one source file.
#
#   scripts/icon/build-icon.sh [source]      (or: make icon [ICON=source])
#
# source: an .svg (rendered at 1024x1024 with headless Chrome) or a 1024x1024 .png.
# Default: build/icon/appicon.svg.
#
# Writes:
#   build/appicon.png      what Wails turns into the macOS .icns on every build,
#                              `wails dev` included
#   build/windows/icon.ico Windows. Wails only creates this when it is missing, so a
#                              stale one would quietly survive an icon change; we always
#                              regenerate it here instead.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SRC="${1:-$ROOT/build/icon/appicon.svg}"
PNG="$ROOT/build/appicon.png"
ICO="$ROOT/build/windows/icon.ico"
SIZE=1024

[ -f "$SRC" ] || { echo "icon source not found: $SRC" >&2; exit 1; }

find_chrome() {
  if [ -n "${CHROME:-}" ]; then echo "$CHROME"; return; fi
  for c in "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
           "/Applications/Chromium.app/Contents/MacOS/Chromium" \
           google-chrome google-chrome-stable chromium chromium-browser; do
    if [ -x "$c" ] || command -v "$c" >/dev/null 2>&1; then echo "$c"; return; fi
  done
  echo "no Chrome/Chromium found; set CHROME=/path/to/chrome, or pass a 1024x1024 PNG" >&2
  exit 1
}

case "$SRC" in
  *.svg)
    tmp="$(mktemp -d)"
    trap 'rm -rf "$tmp"' EXIT
    # Wrap the SVG in a page exactly SIZE px square with a transparent background.
    {
      echo "<!doctype html><html><head><style>html,body{margin:0;background:transparent}"
      echo "svg{display:block;width:${SIZE}px;height:${SIZE}px}</style></head><body>"
      cat "$SRC"
      echo "</body></html>"
    } > "$tmp/icon.html"
    "$(find_chrome)" --headless=new --disable-gpu --hide-scrollbars \
      --default-background-color=00000000 --window-size="$SIZE,$SIZE" \
      --screenshot="$tmp/icon.png" "file://$tmp/icon.html" >/dev/null 2>&1
    cp "$tmp/icon.png" "$PNG"
    ;;
  *.png)
    cp "$SRC" "$PNG"
    ;;
  *)
    echo "icon source must be .svg or .png: $SRC" >&2
    exit 1
    ;;
esac

# Check the size and write the .ico (16..256 px) from the same PNG.
uv run --quiet --with pillow python - "$PNG" "$ICO" "$SIZE" <<'PY'
import sys
from PIL import Image

png, ico, size = sys.argv[1], sys.argv[2], int(sys.argv[3])
img = Image.open(png)
if img.size != (size, size):
    sys.exit(f"{png} is {img.size[0]}x{img.size[1]}, want {size}x{size}")
img.convert("RGBA").save(ico, sizes=[(s, s) for s in (16, 24, 32, 48, 64, 128, 256)])
PY

echo "icon: wrote ${PNG#$ROOT/} and ${ICO#$ROOT/} from ${SRC#$ROOT/}"
echo "      restart 'wails dev' (or rebuild) to see it; the Dock may cache the old one"
