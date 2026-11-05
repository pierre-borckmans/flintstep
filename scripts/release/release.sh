#!/usr/bin/env bash
# Build, sign, package, notarize and checksum a release.
#
#   scripts/release/release.sh VERSION      (or: make release VERSION=v1.2.3)
#
# Writes to build/bin/:
#   <PRODUCT_FILE_NAME>-<VERSION>.dmg
#   SHA256SUMS.txt       shasum -a 256 of the DMG
#   release-notes.md     what the GitHub release says above the generated notes
#
# Two modes, picked by what is available, never by a flag:
#   notarized      a Developer ID identity in the keychain and notary credentials in the
#                  environment (see notarize.sh). The .app is notarized and stapled, then
#                  packed, then the DMG is signed, notarized and stapled too, so both
#                  open offline on first launch.
#   not notarized  anything less: Developer ID without notary credentials, the local
#                  self-signed certificate, or ad hoc. Same files, labelled as such.
#
# PLATFORM=darwin/arm64 builds one architecture instead of universal.
set -euo pipefail
# shellcheck source=../lib/common.sh
. "$(dirname "$0")/../lib/common.sh"
load_product

VERSION="${1:?usage: release.sh VERSION (e.g. v1.2.3)}"
PLATFORM="${PLATFORM:-darwin/universal}"
[[ "$VERSION" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]] ||
  warn "$VERSION is not a vX.Y.Z tag; the bundle keeps wails.json's version"

here="$(dirname "$0")"
DMG="$ROOT/build/bin/$PRODUCT_FILE_NAME-$VERSION.dmg"
SUMS="$ROOT/build/bin/SHA256SUMS.txt"
NOTES="$ROOT/build/bin/release-notes.md"

detect_signing
notarize=0
if [ "$SIGN_MODE" = developer-id ] && notary_configured; then
  notarize=1
  say "mode: Developer ID + notarization ($SIGN_ID)"
else
  case "$SIGN_MODE" in
    developer-id) warn "found \"$SIGN_ID\" but no notary credentials: the release will be signed, NOT notarized" ;;
    local) warn "no Developer ID: signing with the local certificate, the release will NOT be notarized" ;;
    adhoc) warn "no Developer ID: signing ad hoc, the release will NOT be notarized" ;;
  esac
  if [ "$SIGN_MODE" != developer-id ] && notary_configured; then
    warn "notary credentials are set but unused: notarization needs a Developer ID signature"
  fi
fi

"$here/build.sh" "$VERSION" "$PLATFORM"
say "signing the app"
"$here/sign.sh" "$APP_PATH"
if [ "$notarize" = 1 ]; then "$here/notarize.sh" "$APP_PATH"; fi

say "packing $(basename "$DMG")"
"$here/dmg.sh" "$DMG" "$APP_PATH"
"$here/sign.sh" "$DMG"
if [ "$notarize" = 1 ]; then "$here/notarize.sh" "$DMG"; fi

say "verifying"
codesign --verify --strict --deep --verbose=2 "$APP_PATH"
if [ "$notarize" = 1 ]; then
  # What Gatekeeper decides for a downloaded copy. For an app the assessment type is
  # "exec"; a DMG is assessed as a document ("open") against its own signature. (The
  # "install" type is for installer packages.)
  spctl -a -vvv -t exec "$APP_PATH"
  spctl -a -vvv -t open --context context:primary-signature "$DMG"
  xcrun stapler validate "$APP_PATH"
  xcrun stapler validate "$DMG"
fi
# The DMG must mount and hold an app whose signature survived the trip.
mnt="$(mktemp -d)"
hdiutil attach -nobrowse -readonly -noautoopen -mountpoint "$mnt" "$DMG" >/dev/null
trap 'hdiutil detach -quiet "$mnt" 2>/dev/null || true; rmdir "$mnt" 2>/dev/null || true' EXIT
[ -d "$mnt/$PRODUCT_NAME.app" ] || die "the DMG has no $PRODUCT_NAME.app"
[ -L "$mnt/Applications" ] || die "the DMG has no Applications link"
codesign --verify --strict --deep "$mnt/$PRODUCT_NAME.app"
hdiutil detach -quiet "$mnt"
echo "DMG mounts and its app verifies"

(cd "$(dirname "$DMG")" && shasum -a 256 "$(basename "$DMG")") > "$SUMS"

repo="https://github.com/$REPO_SLUG"
if [ "$notarize" = 1 ]; then
  status="notarized"
  cat > "$NOTES" <<EOF
Signed with a Developer ID and notarized by Apple. Open the DMG and drag
**$PRODUCT_NAME** onto Applications.

SHA-256 of the DMG is in \`SHA256SUMS.txt\`. Check it with \`shasum -a 256 -c SHA256SUMS.txt\`.
EOF
else
  status="NOT notarized ($SIGN_MODE)"
  cat > "$NOTES" <<EOF
**Not notarized.** This build is not signed with an Apple Developer ID, so macOS
blocks the first launch. To open it anyway:

1. Drag **$PRODUCT_NAME** from the DMG onto Applications and open it once. macOS says it
   can't verify the app.
2. Open System Settings > Privacy & Security, scroll down and click **Open Anyway**.

Or, from Terminal: \`xattr -dr com.apple.quarantine "/Applications/$PRODUCT_NAME.app"\`

Only do this if you downloaded the DMG from $repo/releases and its checksum
matches \`SHA256SUMS.txt\` (\`shasum -a 256 -c SHA256SUMS.txt\`).
EOF
fi

echo
say "$PRODUCT_NAME $VERSION: $status"
echo "  $DMG"
echo "  $SUMS"
echo "  $NOTES"
