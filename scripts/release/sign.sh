#!/usr/bin/env bash
# Sign an .app (or a .dmg) with the best identity this machine has.
#
#   scripts/release/sign.sh [path]     default: build/bin/<PRODUCT_NAME>.app
#
# The identity is picked by detect_signing in scripts/lib/common.sh:
#   developer-id  "Developer ID Application: ..." in the keychain, or SIGN_IDENTITY.
#                 Hardened runtime, secure timestamp, entitlements: what notarization needs.
#   local         the self-signed "<PRODUCT_NAME> Local Signing" from `make cert`. Keeps
#                 the Bluetooth permission across rebuilds on this Mac. Nobody else's Mac
#                 trusts it.
#   adhoc         no identity. Runs here; Gatekeeper blocks it on other Macs.
#
# All three use the hardened runtime and the same entitlements, so a build that breaks
# under it breaks in `make app` too, not only in CI. Only Developer ID gets --timestamp:
# it needs Apple's timestamp server, and the other two can't be notarized anyway.
#
# Signing goes inside out without --deep: every nested Mach-O, framework, helper app or
# XPC service first, then the bundle itself. --deep signs everything with the outer
# options (entitlements included) and Apple advises against it. Today the Wails bundle
# holds one executable, so the loop finds nothing, but it covers what a future
# dependency might add.
set -euo pipefail
# shellcheck source=../lib/common.sh
. "$(dirname "$0")/../lib/common.sh"
load_product

target="${1:-$APP_PATH}"
[ -e "$target" ] || die "nothing to sign at $target"
detect_signing

opts=(--force --options runtime)
if [ "$SIGN_MODE" = developer-id ]; then
  opts+=(--timestamp)
else
  opts+=(--timestamp=none)
fi

case "$target" in
  *.dmg)
    # A disk image has no entitlements or runtime; it gets a plain signature, and only
    # with a Developer ID (the others add nothing for a downloaded file).
    if [ "$SIGN_MODE" = developer-id ]; then
      codesign --force --timestamp -s "$SIGN_ID" "$target"
      echo "signed $(basename "$target") with \"$SIGN_ID\""
    else
      echo "$(basename "$target"): left unsigned (no Developer ID)"
    fi
    exit 0
    ;;
esac

# Nested code, deepest first. Bundles (.framework, .app, .xpc, .appex) are signed as
# units, after whatever they contain.
contents="$target/Contents"
main_exe="$contents/MacOS/$(/usr/libexec/PlistBuddy -c 'Print :CFBundleExecutable' "$contents/Info.plist")"
nested=()
while IFS= read -r -d '' f; do
  case "$f" in
    *.framework | *.app | *.xpc | *.appex) nested+=("$f") ;;
    *)
      [ "$f" = "$main_exe" ] && continue
      [ -f "$f" ] && file -b "$f" | grep -q 'Mach-O' && nested+=("$f")
      ;;
  esac
done < <(find "$contents" -mindepth 1 \( -name '*.framework' -o -name '*.app' -o -name '*.xpc' \
  -o -name '*.appex' -o -type f \( -perm -u+x -o -name '*.dylib' -o -name '*.so' \) \) -print0)

# Longest path first is deepest first.
if [ "${#nested[@]}" -gt 0 ]; then
  while IFS= read -r f; do
    codesign "${opts[@]}" -s "$SIGN_ID" "$f"
    echo "  signed ${f#"$target/"}"
  done < <(printf '%s\n' "${nested[@]}" | awk '{ print length, $0 }' | sort -rn | cut -d' ' -f2-)
fi

codesign "${opts[@]}" --entitlements "$ENTITLEMENTS" -s "$SIGN_ID" "$target"
codesign --verify --strict --deep --verbose=1 "$target" 2>&1 | sed 's/^/  /'

case "$SIGN_MODE" in
  developer-id) echo "signed with \"$SIGN_ID\" (hardened runtime, timestamped)" ;;
  local) echo "signed with \"$SIGN_ID\": fine on this Mac, not for distribution" ;;
  adhoc) echo "signed ad hoc (run 'make cert' to keep Bluetooth permission across rebuilds)" ;;
esac
