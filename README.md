# Flintstep

[![CI](https://github.com/pierre-borckmans/flintstep/actions/workflows/ci.yml/badge.svg)](https://github.com/pierre-borckmans/flintstep/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/pierre-borckmans/flintstep)](https://github.com/pierre-borckmans/flintstep/releases/latest)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

A macOS menu-bar app that connects to a Positive Grid Spark Control X over Bluetooth and
publishes it as a normal MIDI device named **Flintstep (Spark Control X)**. Logic, Ableton, MainStage,
a browser or anything else that takes MIDI can then use the pedal as a foot controller.
You don't need the Spark app, a Spark amp, a firmware change or Audio MIDI Setup.
Web page: <https://flintstep.app>. There is also an [experimental Linux
build](#linux-experimental).

Positive Grid ships no MIDI mode. The pedal advertises the Bluetooth MIDI service but
never sends anything on it; its switches, expression jacks, battery and LEDs all run over
two vendor services. This app speaks those and turns them into MIDI.

Not affiliated with Positive Grid.

## What it does

- Six switches (I, II, A over III, IV, B), CC 80 to 85 on channel 1 by default. Each one
  can be a momentary or toggle CC, a note or a program change, with an optional long-press
  action. Two-switch combos add more triggers.
- Two expression inputs, CC 11 and CC 7 by default, calibrated in the app (heel/toe). The
  calibration never gets written to the pedal.
- LEDs in two modes. In **local** mode a switch lights while held and while its toggle is
  on. In **MIDI feedback** mode the app listens on a second virtual port, **Flintstep LEDs
  (Spark Control X)**: send the same CC back from your DAW and the LED shows the real state (plugin
  bypassed, track armed).
- Presets: keep several named mappings (one per DAW, one per gig) and switch from the
  editor or the menu bar. Export one as a `.flintstep.json` file and import it on another Mac;
  exports from SparkX MIDI (`.sparkx.json`) and an old `config.json` import too.
- Remembers the pedal and reconnects on its own. Battery level in the menu bar. Optional
  launch at login.

The app never sends the commands that rewrite the profiles stored in the pedal (types 03,
07, 0a, 0e, 13). LED colours are volatile: a power cycle clears them.

## Install

Download `Flintstep-<version>.dmg` from the
[Releases](https://github.com/pierre-borckmans/flintstep/releases) page, open it and drag **Flintstep** onto Applications.

The release notes say whether a build is notarised. A notarised build opens like any
other app. One that isn't gets blocked on first launch: open it once, then go to System
Settings > Privacy & Security and click Open Anyway (on macOS 14 and earlier, right-click
the app and pick Open). Or clear the quarantine flag once:

```sh
xattr -dr com.apple.quarantine "/Applications/Flintstep.app"
```

Each download comes with `SHA256SUMS.txt`; `shasum -a 256 -c SHA256SUMS.txt` checks the
DMG. Universal build, Apple silicon and Intel, macOS 12 or later.

macOS asks for Bluetooth access on first run. The app lives in the menu bar, not the Dock.

### Coming from SparkX MIDI

Flintstep used to be called SparkX MIDI. The first launch under the new name moves
`~/Library/Application Support/SparkX MIDI` to `.../Flintstep` and carries "launch at
login" over. macOS sees a new app, so it asks for Bluetooth access again, and your DAW
sees new MIDI ports called **Flintstep (Spark Control X)** and **Flintstep LEDs (Spark
Control X)**: pick them again where you used the old ones. You can delete
`SparkX MIDI.app` afterwards.

## Linux (experimental)

There is a Linux build. It compiles, packages and starts, and CI smoke-tests it in a
container, but nobody has used it with a real pedal yet: the Bluetooth and MIDI code
has never met the hardware on Linux. If you try it, please
[open an issue](https://github.com/pierre-borckmans/flintstep/issues) and say what
worked and what didn't (distribution, desktop, `~/.config/Flintstep/app.log`).

Releases that include it carry `Flintstep-<version>-x86_64.AppImage` /
`-aarch64.AppImage` and `flintstep_<version>_amd64.deb` / `_arm64.deb`, with
`SHA256SUMS-linux.txt`.

- **.deb** (Debian 12+, Ubuntu 22.04+): `sudo apt install ./flintstep_<version>_amd64.deb`.
  It pulls in GTK 3, WebKitGTK 4.1 and ALSA, and recommends BlueZ.
- **AppImage**: `chmod +x Flintstep-*.AppImage` and run it. It does not bundle GTK or
  WebKit, so it needs `libwebkit2gtk-4.1-0` and `libasound2` installed (most desktops
  have them), and FUSE 2 or 3 to mount itself.

What it needs from the system:

- **BlueZ**, running: `systemctl status bluetooth`. The app talks to `bluetoothd` over
  the system D-Bus, as any desktop Bluetooth tool does; the default BlueZ policy lets a
  logged-in user do that. If the app says it is not allowed, check
  `/etc/dbus-1/system.d/bluetooth.conf`. A soft-blocked adapter shows as "blocked by
  rfkill": `rfkill unblock bluetooth`.
- **The ALSA sequencer** (`/dev/snd/seq`, module `snd-seq`; loaded on any desktop with
  sound). Your user must be able to open it, which on most distributions means being
  logged in at the seat or in the `audio` group. The pedal shows up as ALSA ports
  **Flintstep (Spark Control X)** and **Flintstep LEDs (Spark Control X)**; PipeWire
  and JACK applications see them through their ALSA MIDI bridges (`aconnect -l` lists
  them).
- **A tray**, for the menu-bar behaviour: KDE, Xfce, Cinnamon and Ubuntu's GNOME show
  it; stock GNOME needs the AppIndicator extension. Without a tray the window's close
  button quits the app instead of hiding it.

The remembered pedal is stored per OS (a MAC address here, a CoreBluetooth identifier
on macOS), so the first launch on Linux finds the pedal again by name. "Launch at
login" writes `~/.config/autostart/flintstep.desktop`. Data lives in
`~/.config/Flintstep/`. Build it yourself with `make linux` (Docker); see
[docs/PORTING.md](docs/PORTING.md) for what was tested and how.

## Layout

| Path | What |
| --- | --- |
| `internal/sparkx` | The pedal protocol. Pure Go, no Bluetooth. |
| `internal/ble` | Bluetooth link via tinygo bluetooth (CoreBluetooth on macOS, BlueZ on Linux): find, connect, reconnect, lamps. |
| `internal/mapping` | Config and the engine: switch edges and exp values in, MIDI and lamp colours out. |
| `internal/bridge` | Glue between the pedal, the engine and the MIDI port. Tested with fakes. |
| `internal/coremidi` | Virtual MIDI source and LED destination (cgo): CoreMIDI, or ALSA sequencer ports on Linux. |
| `internal/tray`, `internal/loginitem` | Menu-bar item and LaunchAgent; on Linux a StatusNotifierItem and an XDG autostart entry. |
| `internal/platform` | The list of per-OS seams and a test pinning their signatures. |
| `internal/presets` | The preset library (library.json), export and import. |
| `internal/store`, `internal/rotlog` | Atomic file writes, the old config file, the data folder move, capped logs. |
| `internal/product` | The app's names, checked against `product.env` by a test. |
| `cmd/flintstep-cli` | The bridge as a terminal command, no UI. |
| `frontend/` | React + Tailwind UI. |
| `tools/probe/sparkx.swift` | The CoreBluetooth probe the protocol was checked with. |
| `build/linux`, `scripts/linux` | The Linux Docker image, build, packaging and smoke test. |

`docs/CONTRACTS.md` has the interfaces between the packages. `docs/RELEASING.md` covers
signing, notarisation and cutting a release. Names used by the build live in `product.env`.

Data lives in `~/Library/Application Support/Flintstep/`: `library.json` (the presets),
`app.log`, `ble-trace.log`. Versions before presets kept one mapping in `config.json`; the
first launch with presets turns it into a preset called "My mapping" and leaves the file
alone. If `library.json` is ever unreadable, the app moves it aside as
`library.json.corrupt-<time>`, starts from the defaults and says so in the preset menu.

## Develop

Needs Go 1.25+, bun 1.3.14, Wails v2.17 (`go install github.com/wailsapp/wails/v2/cmd/wails@v2.17.0`)
and golangci-lint v2.

```sh
make install   # frontend deps
make dev       # wails dev, live reload
make cert      # once per Mac: local signing cert, so Bluetooth permission survives rebuilds
make app       # build/bin/Flintstep.app (universal; PLATFORM=darwin/arm64 is faster)
make dmg       # build/bin/Flintstep-<version>.dmg, version from git describe
make release VERSION=v0.2.0   # signed DMG + checksums, notarised when credentials exist
make cli       # build/bin/flintstep-cli
make check     # lint + tests, what CI runs
make linux     # Linux binary, AppImage and .deb for amd64 and arm64, in Docker
make linux-test   # Linux vet, lint and tests with cgo, in Docker
make linux-smoke  # start the Linux binary under Xvfb, in Docker
```

Without the app: `go run ./cmd/flintstep-cli -scan` lists pedals, and
`go run ./cmd/flintstep-cli` bridges the first one it finds and prints every message.

Turn the pedal on and keep the Spark app closed. A pedal holds one connection to an app at
a time.

## Credits

Paul Hamshere's [Spark-Control-X](https://github.com/paulhamsh/Spark-Control-X) notes
first wrote the protocol down. Parts of the Bluetooth layer were adapted from the
author's earlier BEAM Mini controller project.

## Licence

MIT, see [LICENSE](LICENSE). The licences of the Go modules and frontend packages
built into the app are in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md), which ships
inside the app and the DMG; in the app it is under Settings > App > Acknowledgements.
`make notices` regenerates it after a dependency change, and CI fails until it is
current. Contributions: [CONTRIBUTING.md](CONTRIBUTING.md). Security
reports: [SECURITY.md](SECURITY.md).

Spark and Spark Control X are trademarks of Positive Grid; this project is not
affiliated with or endorsed by Positive Grid.
