# SparkX MIDI

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
- Remembers the pedal and reconnects on its own. Battery level in the menu bar. Optional
  launch at login.

The app never sends the commands that rewrite the profiles stored in the pedal (types 03,
07, 0a, 0e, 13). LED colours are volatile: a power cycle clears them.

## Layout

| Path | What |
| --- | --- |
| `internal/sparkx` | The pedal protocol. Pure Go, no Bluetooth. Lifted from the Beam app. |
| `internal/ble` | CoreBluetooth link via tinygo bluetooth: find, connect, reconnect, lamps. |
| `internal/mapping` | Config and the engine: switch edges and exp values in, MIDI and lamp colours out. |
| `internal/bridge` | Glue between the pedal, the engine and the MIDI port. Tested with fakes. |
| `internal/coremidi` | Virtual MIDI source and LED destination (cgo). |
| `internal/tray`, `internal/loginitem` | Menu-bar item and LaunchAgent. |
| `internal/store`, `internal/rotlog` | Config file and capped logs. |
| `cmd/sparkx-midi` | The bridge as a terminal command, no UI. |
| `frontend/` | React + Tailwind UI. |
| `tools/probe/sparkx.swift` | The CoreBluetooth probe the protocol was checked with. |

`docs/CONTRACTS.md` has the interfaces between the packages.

Data lives in `~/Library/Application Support/SparkX MIDI/`: `config.json`, `app.log`,
`ble-trace.log`.

## Develop

Needs Go 1.25+, bun 1.3.14, Wails v2.17 (`go install github.com/wailsapp/wails/v2/cmd/wails@v2.17.0`)
and golangci-lint v2.

```sh
make install   # frontend deps
make dev       # wails dev, live reload
make app       # build/bin/SparkX MIDI.app
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
