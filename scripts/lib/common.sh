# shellcheck shell=bash
# SIGN_MODE and SIGN_ID are set here for the scripts that source this file.
# shellcheck disable=SC2034

# Shared by the build and release scripts. Source it, don't run it:
#
#   . "$(dirname "$0")/../lib/common.sh"
#
# Loads product.env into the environment and defines the signing helpers.

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
export ROOT

# load_product: export every KEY=value from product.env. Values keep their spaces, which
# `source` would not allow without quotes.
load_product() {
  local file="$ROOT/product.env" key value
  [ -f "$file" ] || die "missing $file"
  while IFS= read -r line || [ -n "$line" ]; do
    case "$line" in '' | '#'*) continue ;; esac
    key="${line%%=*}"
    value="${line#*=}"
    [[ "$key" =~ ^[A-Z_][A-Z0-9_]*$ ]] || die "product.env: bad line: $line"
    export "$key=$value"
  done < "$file"
  for key in PRODUCT_NAME BUNDLE_ID MIDI_PORT_NAME MIDI_LED_PORT_NAME DATA_DIR_NAME CLI_NAME REPO_SLUG SITE_URL; do
    [ -n "${!key:-}" ] || die "product.env: $key is empty"
  done
  # Derived names. File names get hyphens instead of spaces.
  PRODUCT_FILE_NAME="${PRODUCT_NAME// /-}"
  LOCAL_SIGN_ID="$PRODUCT_NAME Local Signing"
  # The local certificate's name from before the rename to Flintstep. A Mac that has it
  # keeps signing with it until it has the new one; see scripts/signing/local-cert.sh.
  LEGACY_LOCAL_SIGN_ID="SparkX MIDI Local Signing"
  APP_PATH="$ROOT/build/bin/$PRODUCT_NAME.app"
  ENTITLEMENTS="$ROOT/build/darwin/entitlements.plist"
  export PRODUCT_FILE_NAME LOCAL_SIGN_ID LEGACY_LOCAL_SIGN_ID APP_PATH ENTITLEMENTS
}

say() { printf '\033[1m==> %s\033[0m\n' "$*"; }
warn() { printf '\033[33mwarning: %s\033[0m\n' "$*" >&2; }
die() { printf '\033[31merror: %s\033[0m\n' "$*" >&2; exit 1; }

# detect_signing sets SIGN_MODE to one of
#   developer-id  a "Developer ID Application" identity is available (or SIGN_IDENTITY names one)
#   local         the self-signed certificate from `make cert` is in the keychain (under
#                 the current name, or the one from before the rename)
#   adhoc         neither
# and SIGN_ID to the identity codesign should use ("-" for ad hoc).
#
# SIGN_IDENTITY overrides the search: set it to the full identity name, e.g.
# "Developer ID Application: Jane Doe (AB12CD34EF)", or to "-" to force ad hoc.
detect_signing() {
  if [ -n "${SIGN_IDENTITY:-}" ]; then
    SIGN_ID="$SIGN_IDENTITY"
    case "$SIGN_ID" in
      -) SIGN_MODE=adhoc ;;
      "Developer ID Application"*) SIGN_MODE=developer-id ;;
      *) SIGN_MODE=local ;;
    esac
    return
  fi
  # find-identity -v lists only identities whose chain macOS trusts, which a self-signed
  # certificate is not; that is why the local one is looked up by name below.
  local devid
  devid="$(security find-identity -v -p codesigning 2>/dev/null |
    sed -n 's/.*"\(Developer ID Application: [^"]*\)".*/\1/p' | head -n 1)"
  if [ -n "$devid" ]; then
    SIGN_MODE=developer-id SIGN_ID="$devid"
  elif security find-certificate -c "$LOCAL_SIGN_ID" >/dev/null 2>&1; then
    SIGN_MODE=local SIGN_ID="$LOCAL_SIGN_ID"
  elif security find-certificate -c "$LEGACY_LOCAL_SIGN_ID" >/dev/null 2>&1; then
    SIGN_MODE=local SIGN_ID="$LEGACY_LOCAL_SIGN_ID"
  else
    SIGN_MODE=adhoc SIGN_ID="-"
  fi
}

# notary_configured: true when one of the three credential sets for notarytool is complete.
notary_configured() {
  [ -n "${NOTARY_PROFILE:-}" ] && return 0
  [ -n "${NOTARY_KEY_ID:-}" ] && [ -n "${NOTARY_ISSUER:-}" ] && [ -n "${NOTARY_KEY_P8:-}" ] && return 0
  [ -n "${NOTARY_APPLE_ID:-}" ] && [ -n "${NOTARY_TEAM_ID:-}" ] && [ -n "${NOTARY_PASSWORD:-}" ] && return 0
  return 1
}
