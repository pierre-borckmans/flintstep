#!/usr/bin/env bash
# Copy the product identity from product.env into the files that can't read it themselves.
#
#   scripts/product/sync.sh          (or: make product) rewrite them
#   scripts/product/sync.sh --check  exit 1 if any of them is out of date (CI)
#
# Wails takes the .app name and the executable name from wails.json, and the bundle id
# from build/darwin/Info.plist, which it renders as a Go template with only the
# wails.json fields in scope. Neither can include another file, so this script writes
# the values in. Everything else in those files is left alone.
#
# Needs jq (part of macOS 15 and later, preinstalled on GitHub runners).
set -euo pipefail
# shellcheck source=../lib/common.sh
. "$(dirname "$0")/../lib/common.sh"
load_product

check=0
[ "${1:-}" = "--check" ] && check=1
command -v jq >/dev/null || die "jq not found (brew install jq)"

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
stale=0

# update FILE: compare FILE with $tmp/out and either replace it or report it.
update() {
  local file="$1"
  if cmp -s "$tmp/out" "$ROOT/$file"; then
    return
  fi
  if [ "$check" = 1 ]; then
    echo "$file is out of date with product.env (run 'make product')" >&2
    diff -u "$ROOT/$file" "$tmp/out" >&2 || true
    stale=1
  else
    cp "$tmp/out" "$ROOT/$file"
    echo "updated $file"
  fi
}

jq --arg name "$PRODUCT_NAME" '
  .name = $name
  | .outputfilename = $name
  | .info.productName = $name
  | .info.comments = ($name + " turns a Spark Control X or REACTOR Control into a MIDI foot controller. Not affiliated with Positive Grid.")
' "$ROOT/wails.json" > "$tmp/out"
update wails.json

for plist in build/darwin/Info.plist build/darwin/Info.dev.plist; do
  BUNDLE_ID="$BUNDLE_ID" perl -0pe \
    's{(<key>CFBundleIdentifier</key>\s*<string>)[^<]*(</string>)}{$1$ENV{BUNDLE_ID}$2}' \
    "$ROOT/$plist" > "$tmp/out"
  update "$plist"
done

exit "$stale"
