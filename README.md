# SparkX MIDI

[![CI](https://github.com/pierre-borckmans/spark-control-x-midi/actions/workflows/ci.yml/badge.svg)](https://github.com/pierre-borckmans/spark-control-x-midi/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/pierre-borckmans/spark-control-x-midi)](https://github.com/pierre-borckmans/spark-control-x-midi/releases/latest)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

A macOS menu-bar app that connects to a Positive Grid Spark Control X over Bluetooth and
publishes it as a normal MIDI device named **Spark Control X**. Logic, Ableton, MainStage,
a browser or anything else that takes MIDI can then use the pedal as a foot controller.
You don't need the Spark app, a Spark amp, a firmware change or Audio MIDI Setup.

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
  on. In **MIDI feedback** mode the app listens on a second virtual port, **Spark Control X
  LEDs**: send the same CC back from your DAW and the LED shows the real state (plugin
  bypassed, track armed).
- Presets: keep several named mappings (one per DAW, one per gig) and switch from the
  editor or the menu bar. Export one as a `.sparkx.json` file and import it on another Mac;
  an old `config.json` imports too.
- Remembers the pedal and reconnects on its own. Battery level in the menu bar. Optional
  launch at login.

The app never sends the commands that rewrite the profiles stored in the pedal (types 03,
07, 0a, 0e, 13). LED colours are volatile: a power cycle clears them.

## Install

Download `SparkX-MIDI-<version>.dmg` from the
[Releases](https://github.com/pierre-borckmans/spark-control-x-midi/releases) page, open it and
drag **SparkX MIDI** onto Applications.

The release notes say whether a build is notarised. A notarised build opens like any
other app. One that isn't gets blocked on first launch: open it once, then go to System
Settings > Privacy & Security and click Open Anyway (on macOS 14 and earlier, right-click
the app and pick Open). Or clear the quarantine flag once:

```sh
xattr -dr com.apple.quarantine "/Applications/SparkX MIDI.app"
```

Each download comes with `SHA256SUMS.txt`; `shasum -a 256 -c SHA256SUMS.txt` checks the
DMG. Universal build, Apple silicon and Intel, macOS 12 or later.

macOS asks for Bluetooth access on first run. The app lives in the menu bar, not the Dock.

## Layout

| Path | What |
| --- | --- |
| `internal/sparkx` | The pedal protocol. Pure Go, no Bluetooth. Lifted from the Beam app. |
| `internal/ble` | CoreBluetooth link via tinygo bluetooth: find, connect, reconnect, lamps. |
| `internal/mapping` | Config and the engine: switch edges and exp values in, MIDI and lamp colours out. |
| `internal/bridge` | Glue between the pedal, the engine and the MIDI port. Tested with fakes. |
| `internal/coremidi` | Virtual MIDI source and LED destination (cgo). |
| `internal/tray`, `internal/loginitem` | Menu-bar item and LaunchAgent. |
| `internal/presets` | The preset library (library.json), export and import. |
| `internal/store`, `internal/rotlog` | Atomic file writes, the old config file, capped logs. |
| `cmd/sparkx-midi` | The bridge as a terminal command, no UI. |
| `frontend/` | React + Tailwind UI. |
| `tools/probe/sparkx.swift` | The CoreBluetooth probe the protocol was checked with. |

`docs/CONTRACTS.md` has the interfaces between the packages. `docs/RELEASING.md` covers
signing, notarisation and cutting a release. Names used by the build live in `product.env`.

Data lives in `~/Library/Application Support/SparkX MIDI/`: `library.json` (the presets),
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
make app       # build/bin/SparkX MIDI.app (universal; PLATFORM=darwin/arm64 is faster)
make dmg       # build/bin/SparkX-MIDI-<version>.dmg, version from git describe
make release VERSION=v0.2.0   # signed DMG + checksums, notarised when credentials exist
make cli       # build/bin/sparkx-midi
make check     # lint + tests, what CI runs
```

Without the app: `go run ./cmd/sparkx-midi -scan` lists pedals, and
`go run ./cmd/sparkx-midi` bridges the first one it finds and prints every message.

Turn the pedal on and keep the Spark app closed. A pedal holds one connection to an app at
a time.

## Credits

Paul Hamshere's [Spark-Control-X](https://github.com/paulhamsh/Spark-Control-X) notes
first wrote the protocol down.

## Licence

MIT, see [LICENSE](LICENSE). Contributions: [CONTRIBUTING.md](CONTRIBUTING.md). Security
reports: [SECURITY.md](SECURITY.md).

Spark and Spark Control X are trademarks of Positive Grid; this project is not
affiliated with or endorsed by Positive Grid.
