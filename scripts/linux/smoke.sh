#!/usr/bin/env bash
# Smoke test of the Linux binary, inside the build image: no Bluetooth hardware, no
# pedal, no desktop. It checks the app starts and stays up under Xvfb with a session bus,
# says something sensible about Bluetooth, and creates its MIDI ports when the kernel
# has an ALSA sequencer. It proves nothing about a real pedal.
#
#   scripts/linux/smoke.sh BINARY SHOTS_DIR
#
# Three runs, each in a fresh session bus:
#   1. a system bus, bluetoothd not running   -> "The Bluetooth service is not running"
#   2. BlueZ answering with no adapter        -> "No Bluetooth adapter found"; screenshot
#   3. BlueZ with an adapter that is off      -> "Bluetooth is off"
# The container's kernel has no Bluetooth, so the real bluetoothd exits at once; runs 2
# and 3 use tools/fakebluez, which owns org.bluez and answers GetManagedObjects.
# Set SRC to the repo to build it (docker.sh mounts it at /src).
set -euo pipefail
BIN="${1:?usage: smoke.sh BINARY SHOTS_DIR}"
SHOTS="${2:?usage: smoke.sh BINARY SHOTS_DIR}"
RUN_FOR="${RUN_FOR:-8}"
mkdir -p "$SHOTS"
fail() { printf 'SMOKE FAIL: %s\n' "$*" >&2; exit 1; }

export HOME=/tmp/smoke-home XDG_RUNTIME_DIR=/tmp/smoke-run
rm -rf "$HOME" "$XDG_RUNTIME_DIR"
mkdir -p "$HOME" "$XDG_RUNTIME_DIR"
chmod 700 "$XDG_RUNTIME_DIR"
# WebKit in a VM without a GPU: software rendering, no compositing.
export LIBGL_ALWAYS_SOFTWARE=1 WEBKIT_DISABLE_COMPOSITING_MODE=1 NO_AT_BRIDGE=1

Xvfb :99 -screen 0 1280x900x24 -nolisten tcp >/dev/null 2>&1 &
xvfb=$!
export DISPLAY=:99
for _ in $(seq 50); do xdpyinfo >/dev/null 2>&1 && break; sleep 0.1; done 2>/dev/null || true

mkdir -p /run/dbus
rm -f /run/dbus/pid
dbus-daemon --system --fork
bluetoothd=""
for b in "$(command -v bluetoothd || true)" /usr/lib/bluetooth/bluetoothd /usr/libexec/bluetooth/bluetoothd; do
  if [ -n "$b" ] && [ -x "$b" ]; then bluetoothd="$b" && break; fi
done

if [ -e /dev/snd/seq ]; then echo "/dev/snd/seq present: expecting the ALSA ports"; else echo "no /dev/snd/seq: expecting the MIDI error, not the ports"; fi

# run NAME EXPECT_BLE [screenshot]: start the app in its own session bus, let it run,
# check it is still alive, grab the screen, stop it, then check its log.
run() {
  local name="$1" expect="$2" shot="${3:-}" log="$SHOTS/$1.log"
  echo "==> run $name"
  rm -rf "$HOME/.config/Flintstep"
  # shellcheck disable=SC2016 # the inner script takes its values as $0..$3
  dbus-run-session -- bash -c '
    "$0" > "$1" 2>&1 &
    app=$!
    sleep "$2"
    if ! kill -0 $app 2>/dev/null; then echo "app exited early" >> "$1"; wait $app; echo "exit status $?" >> "$1"; exit 1; fi
    if [ -n "$3" ]; then import -window root "$3" || xwd -root -silent | convert xwd:- "$3"; fi
    kill $app; wait $app 2>/dev/null || true' "$BIN" "$log" "$RUN_FOR" "$shot" || { cat "$log"; fail "$name: the app did not stay up"; }
  cat "$log"
  grep -q "Flintstep .* starting" "$log" || fail "$name: no start line"
  grep -qF "$expect" "$log" || fail "$name: expected \"$expect\" in the log"
  if [ -e /dev/snd/seq ]; then
    grep -q "midi: virtual source" "$log" || fail "$name: no MIDI ports"
  else
    grep -q "midi: coremidi: the ALSA sequencer is not available" "$log" || fail "$name: no MIDI error"
  fi
  if grep -qiE "panic|SIGSEGV|fatal error" "$log"; then fail "$name: crash in the log"; fi
  echo "ok: $name"
}

run no-bluetoothd "The Bluetooth service is not running"

# The real daemon, for the record: without kernel Bluetooth it exits straight away.
if [ -n "$bluetoothd" ]; then
  timeout 3 "$bluetoothd" -n >"$SHOTS/bluetoothd.log" 2>&1 || true
fi

(cd "${SRC:-/src}" && go build -o /tmp/fakebluez ./tools/fakebluez)
fake() {
  /tmp/fakebluez "$1" &
  bt=$!
  sleep 0.5
}
fake none
run no-adapter "No Bluetooth adapter found" "$SHOTS/window.png"
kill "$bt"
wait "$bt" 2>/dev/null || true
fake off
run adapter-off "ble: Bluetooth is off"
kill "$bt" "$xvfb" 2>/dev/null || true
echo "smoke test passed; screenshot: $SHOTS/window.png"
