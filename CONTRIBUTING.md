# Contributing

Bug reports, protocol findings and pull requests are welcome.

## Build and test

You need macOS, Go 1.25+, bun 1.3.14, Wails v2.17
(`go install github.com/wailsapp/wails/v2/cmd/wails@v2.17.0`) and golangci-lint v2.

```sh
make install   # frontend deps
make dev       # run the app with live reload
make check     # lint + tests, the same as CI
make app       # build/bin/<name>.app
```

Run `make cert` once so macOS keeps the Bluetooth permission across rebuilds, and
`make hooks` for a pre-commit check. The Go tests use fakes and run on Linux too; nothing
in `make check` needs a pedal.

In `frontend/`, `bun run dev` serves the UI against a mock backend (`src/mock.ts`), the
quickest way to work on the interface.

## How the code is split

`docs/CONTRACTS.md` is the agreement between the packages: names, signatures and
behaviour. If a change alters a contract, update that file in the same PR. Protocol
discoveries go in `docs/PROTOCOL-NOTES.md`, with the firmware version you checked.

Never add code that sends the commands which rewrite the pedal's stored profiles (types
03, 07, 0a, 0e, 13). The app only reads the pedal and sets volatile LED colours.

## Pull requests

- One change per PR, saying what it does and how you checked it.
- `make check` passes. New behaviour comes with a test where one is practical.
- UI changes: a screenshot.
- Bluetooth or MIDI changes: the pedal firmware and macOS version you tried.

The maintainer cuts releases; see `docs/RELEASING.md`.
