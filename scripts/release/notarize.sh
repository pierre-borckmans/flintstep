#!/usr/bin/env bash
# Notarize an .app or a .dmg with Apple, wait for the verdict, staple the ticket.
#
#   scripts/release/notarize.sh <path.app|path.dmg>
#
# Credentials, first complete set wins:
#   NOTARY_PROFILE                              a keychain profile made with
#                                               `xcrun notarytool store-credentials`
#   NOTARY_KEY_ID, NOTARY_ISSUER, NOTARY_KEY_P8 App Store Connect API key. NOTARY_KEY_P8
#                                               is the .p8 file's text (PEM), its base64,
#                                               or a path to the file.
#   NOTARY_APPLE_ID, NOTARY_TEAM_ID, NOTARY_PASSWORD
#                                               Apple ID with an app-specific password.
#
# An .app is zipped with ditto first, since notarytool takes zip, dmg or pkg. Apple
# keeps the ticket under each signed item's code hash, so the stapled .app inside a DMG
# made afterwards keeps it, and the DMG gets its own ticket when it is notarized next.
#
# On rejection the script prints Apple's log, which names each file and the problem.
set -euo pipefail
# shellcheck source=../lib/common.sh
. "$(dirname "$0")/../lib/common.sh"
load_product

target="${1:?usage: notarize.sh <path.app|path.dmg>}"
[ -e "$target" ] || die "not found: $target"
notary_configured || die "no notarization credentials (see the header of $0)"

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

auth=()
if [ -n "${NOTARY_PROFILE:-}" ]; then
  auth=(--keychain-profile "$NOTARY_PROFILE")
elif [ -n "${NOTARY_KEY_ID:-}" ] && [ -n "${NOTARY_ISSUER:-}" ] && [ -n "${NOTARY_KEY_P8:-}" ]; then
  key="$tmp/AuthKey_$NOTARY_KEY_ID.p8"
  if [ -f "$NOTARY_KEY_P8" ]; then
    cp "$NOTARY_KEY_P8" "$key"
  elif printf '%s' "$NOTARY_KEY_P8" | grep -q 'BEGIN PRIVATE KEY'; then
    printf '%s\n' "$NOTARY_KEY_P8" > "$key"
  else
    printf '%s' "$NOTARY_KEY_P8" | base64 --decode > "$key" || die "NOTARY_KEY_P8 is not PEM, base64 or a file"
  fi
  chmod 600 "$key"
  auth=(--key "$key" --key-id "$NOTARY_KEY_ID" --issuer "$NOTARY_ISSUER")
else
  auth=(--apple-id "$NOTARY_APPLE_ID" --team-id "$NOTARY_TEAM_ID" --password "$NOTARY_PASSWORD")
fi

upload="$target"
case "$target" in
  *.app)
    upload="$tmp/$(basename "$target" .app).zip"
    ditto -c -k --sequesterRsrc --keepParent "$target" "$upload"
    ;;
  *.dmg | *.pkg | *.zip) ;;
  *) die "can't notarize $target (want .app, .dmg, .pkg or .zip)" ;;
esac

say "notarizing $(basename "$target") (this takes a few minutes)"
# notarytool exits 0 on Invalid too, so read the status from the JSON instead.
set +e
xcrun notarytool submit "$upload" "${auth[@]}" --wait --timeout 30m --output-format json > "$tmp/submit.json"
rc=$?
set -e
id="$(plutil -extract id raw -o - "$tmp/submit.json" 2>/dev/null || true)"
status="$(plutil -extract status raw -o - "$tmp/submit.json" 2>/dev/null || true)"
echo "submission ${id:-?}: ${status:-unknown}"

if [ "$rc" -ne 0 ] || [ "$status" != "Accepted" ]; then
  cat "$tmp/submit.json" >&2 || true
  if [ -n "$id" ]; then
    echo "---- notarytool log $id ----" >&2
    xcrun notarytool log "$id" "${auth[@]}" >&2 || true
  fi
  die "notarization failed for $(basename "$target")"
fi

xcrun stapler staple "$target"
xcrun stapler validate "$target"
echo "notarized and stapled $(basename "$target")"
