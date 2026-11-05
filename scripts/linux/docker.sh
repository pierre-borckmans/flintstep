#!/usr/bin/env bash
# Run the Linux build, tests or smoke test in Docker, from macOS or Linux.
#
#   scripts/linux/docker.sh build VERSION [ARCH...]   app + AppImage + .deb per arch
#   scripts/linux/docker.sh test [ARCH...]            go vet + go test with cgo (ALSA)
#   scripts/linux/docker.sh smoke [ARCH...]           launch the built binary under Xvfb
#
# ARCH is amd64 and/or arm64 (default: both for build, the host's for test and smoke).
# A foreign architecture runs emulated (OrbStack/Docker Desktop do this), slower.
# Output: build/bin/linux/<arch>/. Go's module and build caches persist in Docker
# volumes between runs.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=../lib/common.sh
. "$here/../lib/common.sh"
load_product

mode="${1:?usage: docker.sh build|test|smoke ...}"
shift
version=""
if [ "$mode" = build ]; then
  version="${1:?usage: docker.sh build VERSION [ARCH...]}"
  shift
fi
host_arch="$(uname -m)"
case "$host_arch" in x86_64) host_arch=amd64 ;; aarch64 | arm64) host_arch=arm64 ;; esac
if [ $# -eq 0 ]; then
  if [ "$mode" = build ]; then set -- amd64 arm64; else set -- "$host_arch"; fi
fi

for arch in "$@"; do
  case "$arch" in amd64 | arm64) ;; *) die "unknown arch $arch (amd64 or arm64)" ;; esac
  image="flintstep-linux-build:$arch"
  say "image $image"
  docker build --platform "linux/$arch" -t "$image" "$ROOT/build/linux"
  out="$ROOT/build/bin/linux/$arch"
  mkdir -p "$out"
  run=(docker run --rm --platform "linux/$arch"
    -v "$ROOT:/src:ro" -v "$out:/out"
    -v "flintstep-gomod:/root/go/pkg/mod" -v "flintstep-gocache-$arch:/root/.cache/go-build"
    -e SRC=/src)
  case "$mode" in
    build)
      "${run[@]}" "$image" /src/scripts/linux/build.sh "$version" /out
      ;;
    test)
      # The integration test of the ALSA ports needs /dev/snd/seq; it skips without it.
      dev=()
      if [ -e /dev/snd/seq ]; then dev=(--device /dev/snd/seq); fi
      # shellcheck disable=SC2016 # expanded by the container's shell
      "${run[@]}" ${dev[@]+"${dev[@]}"} "$image" bash -c '
        set -euo pipefail
        mkdir -p /tmp/w && cd /src && tar --exclude=./frontend/node_modules --exclude=./build/bin --exclude=./.git --exclude=./.claude -cf - . | tar -C /tmp/w -xf -
        cd /tmp/w && mkdir -p frontend/dist && [ -n "$(ls -A frontend/dist)" ] || echo "<!doctype html><title>stub</title>" > frontend/dist/index.html
        echo "==> go vet (linux, cgo)" && go vet ./...
        echo "==> go vet (linux, cgo, desktop tags: the real app build)" && go vet -tags desktop,production,webkit2_41 .
        echo "==> golangci-lint (linux, cgo)" && go install github.com/golangci/golangci-lint/v2/cmd/golangci-lint@v2.10.1 && golangci-lint run ./...
        echo "==> go test -race" && go test -race ./... 2>&1
        echo "==> ALSA tests, verbose" && go test -v -run "ALSA|NoSequencer|OpenError" ./internal/coremidi/'
      ;;
    smoke)
      [ -x "$out/flintstep" ] || die "no $out/flintstep: run 'make linux' first"
      shots="${SMOKE_OUT:-$ROOT/build/bin/linux/smoke}"
      mkdir -p "$shots"
      "${run[@]}" -v "$shots:/shots" "$image" /src/scripts/linux/smoke.sh /out/flintstep /shots
      ;;
    *) die "unknown mode $mode" ;;
  esac
done
