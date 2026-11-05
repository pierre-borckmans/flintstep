#!/usr/bin/env bash
# Pack the .app into a compressed DMG with the usual drag-to-Applications layout.
#
#   scripts/release/dmg.sh <out.dmg> [app]     app defaults to build/bin/<PRODUCT_NAME>.app
#
# The image holds the app and a symlink to /Applications, nothing else. No background
# picture or window layout yet; Finder shows the two icons side by side.
set -euo pipefail
# shellcheck source=../lib/common.sh
. "$(dirname "$0")/../lib/common.sh"
load_product

out="${1:?usage: dmg.sh <out.dmg> [app]}"
app="${2:-$APP_PATH}"
[ -d "$app" ] || die "no app at $app"

stage="$ROOT/build/dmg"
rm -rf "$stage" "$out"
mkdir -p "$stage"
trap 'rm -rf "$stage"' EXIT
# ditto keeps the signature, extended attributes and any stapled ticket intact.
ditto "$app" "$stage/$(basename "$app")"
ln -s /Applications "$stage/Applications"
hdiutil create -volname "$PRODUCT_NAME" -srcfolder "$stage" -fs HFS+ -format UDZO -ov "$out" >/dev/null
echo "wrote $out"
