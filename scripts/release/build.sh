#!/usr/bin/env bash
# Build build/bin/<PRODUCT_NAME>.app, unsigned (Wails' own ad-hoc signature aside).
#
#   scripts/release/build.sh VERSION [PLATFORM]
#
# VERSION   goes into main.version; on a release tag (vX.Y.Z) also into the bundle version.
# PLATFORM  darwin/universal (default), darwin/arm64 or darwin/amd64.
#
# Universal works with the cgo parts (CoreBluetooth through tinygo's cbgo, CoreMIDI,
# AppKit): Wails builds each architecture with clang -arch and joins them with lipo.
set -euo pipefail
# shellcheck source=../lib/common.sh
. "$(dirname "$0")/../lib/common.sh"
load_product

VERSION="${1:?usage: build.sh VERSION [PLATFORM]}"
PLATFORM="${2:-darwin/universal}"
# Go 1.25 runs on macOS 12 and later, so that is the floor whatever Wails defaults to
# (10.13). Keep in step with LSMinimumSystemVersion in build/darwin/Info*.plist.
MIN_MACOS=12.0

"$ROOT/scripts/product/sync.sh" --check || die "product.env and wails.json/Info.plist disagree; run 'make product'"

say "building $PRODUCT_NAME $VERSION ($PLATFORM)"
cd "$ROOT"
# wails -clean leaves files in an existing bundle alone; start from nothing.
rm -rf "$APP_PATH"
export CGO_CFLAGS="${CGO_CFLAGS:+$CGO_CFLAGS }-mmacosx-version-min=$MIN_MACOS"
export CGO_LDFLAGS="${CGO_LDFLAGS:+$CGO_LDFLAGS }-mmacosx-version-min=$MIN_MACOS"
export MACOSX_DEPLOYMENT_TARGET="$MIN_MACOS"
# -trimpath keeps the build machine's paths out of the binary.
wails build -clean -trimpath -platform "$PLATFORM" -ldflags "-X main.version=$VERSION"

[ -d "$APP_PATH" ] || die "wails did not produce $APP_PATH"

# The licences ship with the binary: ours, and the third-party notices (make notices).
cp "$ROOT/LICENSE" "$ROOT/THIRD_PARTY_NOTICES.md" "$APP_PATH/Contents/Resources/"

# wails.json's productVersion is the bundle version. On a release tag the tag wins.
v="${VERSION#v}"
if [[ "$v" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  /usr/libexec/PlistBuddy -c "Set :CFBundleShortVersionString $v" \
    -c "Set :CFBundleVersion $v" "$APP_PATH/Contents/Info.plist"
  echo "bundle version: $v"
fi
echo "architectures: $(lipo -archs "$APP_PATH/Contents/MacOS/$PRODUCT_NAME")"
