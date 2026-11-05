#!/usr/bin/env bash
# Package a built Linux binary as an AppImage and a .deb. Called by build.sh.
#
#   scripts/linux/package.sh VERSION OUT_DIR      (OUT_DIR/flintstep must exist)
#
# Neither package bundles GTK or WebKitGTK: WebKit's helper processes do not survive
# being relocated into an AppImage without patching, and every desktop that can run the
# app has them already. The AppImage therefore needs libwebkit2gtk-4.1-0 and libasound2
# installed; the .deb declares them.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=../lib/common.sh
. "$here/../lib/common.sh"
load_product

VERSION="${1:?usage: package.sh VERSION OUT_DIR}"
OUT="$(cd "${2:?usage: package.sh VERSION OUT_DIR}" && pwd)"
BIN="$OUT/flintstep"
[ -x "$BIN" ] || die "no binary at $BIN"

case "$(uname -m)" in
  x86_64) APPIMAGE_ARCH=x86_64 DEB_ARCH=amd64 ;;
  aarch64 | arm64) APPIMAGE_ARCH=aarch64 DEB_ARCH=arm64 ;;
  *) die "unsupported architecture $(uname -m)" ;;
esac

# deb_version turns a git describe into a Debian version: v1.2.3 -> 1.2.3,
# v1.2.3-4-gabc -> 1.2.3+4.gabc, a bare hash -> 0.0.0+gitabc. "-dirty" becomes ".dirty".
deb_version() {
  local v="${1#v}"
  if [[ "$v" =~ ^[0-9]+\.[0-9]+\.[0-9]+ ]]; then
    local base="${BASH_REMATCH[0]}" rest="${v:${#BASH_REMATCH[0]}}"
    rest="${rest#-}"
    if [ -n "$rest" ]; then echo "$base+${rest//-/.}"; else echo "$base"; fi
  else
    echo "0.0.0+git${v//-/.}"
  fi
}

STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT
cp "$BIN" "$STAGE/flintstep"
cp "$ROOT/build/linux/flintstep.desktop" "$STAGE/flintstep.desktop"
desktop-file-validate "$STAGE/flintstep.desktop"
for s in 256 512; do
  mkdir -p "$STAGE/icons/$s"
  convert "$ROOT/build/appicon.png" -resize "${s}x${s}" "$STAGE/icons/$s/flintstep.png"
done
mkdir -p "$STAGE/doc"
cp "$ROOT/LICENSE" "$STAGE/doc/copyright"
# The licence notices for the Go modules compiled in, when the repo has them.
if [ -f "$ROOT/THIRD_PARTY_NOTICES.md" ]; then cp "$ROOT/THIRD_PARTY_NOTICES.md" "$STAGE/doc/"; fi

say "AppImage"
appdir="$STAGE/AppDir"
mkdir -p "$appdir/usr/bin" "$appdir/usr/share/applications" "$appdir/usr/share/icons/hicolor/256x256/apps" "$appdir/usr/share/doc/flintstep"
cp "$STAGE/flintstep" "$appdir/usr/bin/"
cp "$STAGE/flintstep.desktop" "$appdir/usr/share/applications/"
cp "$STAGE/flintstep.desktop" "$appdir/"
cp "$STAGE/icons/256/flintstep.png" "$appdir/usr/share/icons/hicolor/256x256/apps/"
cp "$STAGE/icons/256/flintstep.png" "$appdir/flintstep.png"
cp -R "$STAGE/doc/." "$appdir/usr/share/doc/flintstep/"
cat > "$appdir/AppRun" <<'EOF'
#!/bin/sh
here="$(dirname "$(readlink -f "$0")")"
exec "$here/usr/bin/flintstep" "$@"
EOF
chmod +x "$appdir/AppRun"
appimage="$OUT/$PRODUCT_FILE_NAME-$VERSION-$APPIMAGE_ARCH.AppImage"
rm -f "$appimage"
ARCH="$APPIMAGE_ARCH" APPIMAGE_EXTRACT_AND_RUN=1 appimagetool --no-appstream \
  --runtime-file /opt/appimage-runtime "$appdir" "$appimage"
chmod +x "$appimage"

say ".deb"
DEB_VERSION="$(deb_version "$VERSION")"
# nfpm expands variables in some fields only (not contents' src), so fill them in here.
sed -e "s|\${STAGE}|$STAGE|g" -e "s|\${DEB_ARCH}|$DEB_ARCH|g" -e "s|\${DEB_VERSION}|$DEB_VERSION|g" \
  "$ROOT/build/linux/nfpm.yaml" > "$STAGE/nfpm.yaml"
nfpm package --config "$STAGE/nfpm.yaml" --packager deb --target "$OUT/"

echo
ls -l "$OUT"
