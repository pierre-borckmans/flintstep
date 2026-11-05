// Package platform is the map of every place Flintstep depends on the OS, and the
// contract each port fills in. It holds no implementation: each seam lives in the
// package that uses it, one file per OS, chosen by build tags. platform_test.go checks
// at compile time that every package still offers its seam with the agreed signatures,
// so `GOOS=<os> go vet ./internal/platform` tells a port what it is missing.
//
// The seams, and who implements them today (darwin = macOS, linux = Linux, other =
// everything else, Windows included, which builds but does nothing; see docs/PORTING.md):
//
//	Seam            Where                       darwin                linux                       other
//	--------------  --------------------------  --------------------  --------------------------  -----------------
//	Radio           internal/ble radio_*.go     CoreBluetooth (cbgo)  BlueZ over D-Bus            "unsupported"
//	Virtual MIDI    internal/coremidi           CoreMIDI (cgo)        ALSA sequencer (cgo)        ErrUnsupported
//	Tray            internal/tray               NSStatusItem (cgo)    StatusNotifierItem (D-Bus)  no-op
//	Login item      internal/loginitem          LaunchAgent plist     XDG autostart .desktop      LaunchAgent code*
//	Theme           package main theme_*.go     NSAppearance          GTK prefer-dark + portal    no-op
//	Activation      package main activate_*.go  activateIgnoring...   no-op (GTK presents)        no-op
//	Window policy   package main platform_*.go  hide on close         hide only with a tray host  close quits
//
// (*) loginitem.go is built everywhere but Linux; a Windows port replaces it with a
// Run-key implementation.
//
// Radio is the one seam with a real Go interface (unexported, internal/ble/radio.go),
// because the Manager is tested against a fake of it. The others are package-level
// functions; their signatures are pinned below and in platform_test.go.
//
// Rules every port keeps:
//
//   - Radio callbacks (sink) may run on the OS's own threads and must not block.
//     Addresses are the OS's own identifier for a peripheral, opaque to the rest of the
//     app; the remembered pedal is per OS.
//   - Virtual MIDI: Send takes one complete message and is safe from any goroutine;
//     onDest gets complete channel messages (run them through coremidi's parser) on a
//     single goroutine; Close waits for the last onDest call.
//   - Tray: Start may be called once the GUI toolkit is up (Wails' OnStartup) and must
//     not take over the main thread; onClick runs on its own goroutine. Available says
//     whether the desktop will show the item at all.
//   - Login item: Enabled/Set/MigrateLegacy, starting the current executable with
//     --hidden, and a pure Render so the file format is unit-tested.
//   - Theme: setNativeTheme(store.Theme) and systemIsDark(), both safe before and after
//     the window exists, from any goroutine.
package platform

import (
	"time"

	"flintstep/internal/tray"
)

// MIDIPort is what the bridge sends to: internal/coremidi.Virtual.
type MIDIPort interface {
	Send(msg []byte) error
	Close()
}

// NewMIDIPort is coremidi.NewVirtual's signature.
type NewMIDIPort[V MIDIPort] func(client, source, dest string, onDest func(msg []byte)) (V, error)

// Tray is internal/tray's package-level API.
type Tray struct {
	Start      func(templateIconPNG []byte, onClick func(id string))
	SetMenu    func(items []tray.Item)
	SetTooltip func(s string)
	Available  func(wait time.Duration) bool
}

// LoginItem is internal/loginitem's package-level API.
type LoginItem struct {
	Enabled       func() bool
	Set           func(on bool) error
	MigrateLegacy func() (found bool, err error)
	Render        func(exe string) []byte
}
