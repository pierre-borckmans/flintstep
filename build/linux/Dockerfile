# The Linux build environment: `make linux` builds this image once per architecture
# and runs scripts/linux/build.sh in it. Ubuntu 22.04 so the binary needs glibc 2.35 at
# most (Ubuntu 22.04+, Debian 12+, Fedora 36+), with WebKitGTK 4.1 (the webkit2_41 tag).
#
#   docker build --platform linux/amd64 -t flintstep-linux-build:amd64 build/linux
FROM ubuntu:22.04

ARG GO_VERSION=1.26.10
ARG BUN_VERSION=1.3.14
ARG NFPM_VERSION=v2.48.0
ARG APPIMAGETOOL_VERSION=1.9.1
ARG APPIMAGE_RUNTIME=20251108
ARG TARGETARCH

ENV DEBIAN_FRONTEND=noninteractive
# Build: compilers, GTK 3, WebKitGTK 4.1, ALSA. Packaging: file, xz, squashfs for
# appimagetool. Smoke test (scripts/linux/smoke.sh): Xvfb, D-Bus, BlueZ, ImageMagick.
RUN apt-get update && apt-get install -y --no-install-recommends \
      build-essential pkg-config ca-certificates curl git unzip file xz-utils \
      libgtk-3-dev libwebkit2gtk-4.1-dev libasound2-dev \
      squashfs-tools desktop-file-utils \
      xvfb xauth dbus dbus-x11 bluez imagemagick x11-apps alsa-utils \
    && rm -rf /var/lib/apt/lists/*

RUN curl -fsSL "https://go.dev/dl/go${GO_VERSION}.linux-${TARGETARCH}.tar.gz" | tar -C /usr/local -xz
ENV PATH=/usr/local/go/bin:/root/go/bin:/root/.bun/bin:$PATH

RUN curl -fsSL https://bun.sh/install | bash -s "bun-v${BUN_VERSION}"

RUN go install "github.com/goreleaser/nfpm/v2/cmd/nfpm@${NFPM_VERSION}"

# appimagetool is itself an AppImage; containers have no FUSE, so it runs extracted.
# The runtime it prepends is pinned too, so packaging needs no network.
RUN set -eu; \
    case "$TARGETARCH" in amd64) a=x86_64 ;; arm64) a=aarch64 ;; *) echo "unsupported $TARGETARCH"; exit 1 ;; esac; \
    curl -fsSL -o /tmp/appimagetool "https://github.com/AppImage/appimagetool/releases/download/${APPIMAGETOOL_VERSION}/appimagetool-$a.AppImage"; \
    chmod +x /tmp/appimagetool; \
    cd /opt && /tmp/appimagetool --appimage-extract >/dev/null && mv squashfs-root appimagetool && rm /tmp/appimagetool; \
    ln -s /opt/appimagetool/AppRun /usr/local/bin/appimagetool; \
    curl -fsSL -o /opt/appimage-runtime "https://github.com/AppImage/type2-runtime/releases/download/${APPIMAGE_RUNTIME}/runtime-$a"

WORKDIR /work
