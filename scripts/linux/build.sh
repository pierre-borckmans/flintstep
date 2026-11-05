#!/usr/bin/env bash
# Build the Linux app and its packages. Runs INSIDE the build/linux/Dockerfile image
# (scripts/linux/docker.sh starts it); on a Linux machine with the same packages it
# also runs as is.
#
#   scripts/linux/build.sh VERSION OUT_DIR
#
# The repo is read from $SRC (default: this checkout) and copied to a scratch tree
# first, so the host's node_modules (macOS binaries) and build output never get in.
# Writes to OUT_DIR:
#   flintstep                              the binary
#   <PRODUCT_FILE_NAME>-<VERSION>-<arch>.AppImage
#   flintstep_<debversion>_<debarch>.deb
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=../lib/common.sh
. "$here/../lib/common.sh"
load_product

VERSION="${1:?usage: build.sh VERSION OUT_DIR}"
OUT="${2:?usage: build.sh VERSION OUT_DIR}"
SRC="${SRC:-$ROOT}"
WORK="${WORK:-/tmp/flintstep-build}"

say "copying the source to $WORK"
rm -rf "$WORK"
mkdir -p "$WORK" "$OUT"
# tar rather than rsync: it is in every base image.
(cd "$SRC" && tar --exclude=./frontend/node_modules --exclude=./frontend/dist \
  --exclude=./build/bin --exclude=./.git --exclude=./.claude -cf - .) | (cd "$WORK" && tar -xf -)
cd "$WORK"

say "frontend"
(cd frontend && bun install --frozen-lockfile && bun run build)

say "binary ($(go env GOARCH))"
# What `wails build` does on Linux, without the CLI: the desktop and production tags,
# WebKitGTK 4.1 (webkit2_41), stripped. CGO is needed for GTK, WebKit and ALSA.
CGO_ENABLED=1 go build -trimpath -buildvcs=false \
  -tags desktop,production,webkit2_41 \
  -ldflags "-s -w -X main.version=$VERSION" \
  -o "$OUT/flintstep" .
file "$OUT/flintstep"

"$here/package.sh" "$VERSION" "$OUT"
