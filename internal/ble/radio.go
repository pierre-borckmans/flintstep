package ble

import (
	"context"
	"time"
)

// THE RADIO SEAM.
//
// Everything the Manager needs from CoreBluetooth goes through radio, so the connect
// path, the reconnect loop and the pedal session are all tested with a fake
// (fake_test.go). The real one is radio_darwin.go; other platforms get a stub that
// reports Bluetooth as unavailable, so the package builds and tests on Linux CI.

// radio is the adapter as the Manager sees it.
type radio interface {
	// power reports whether Bluetooth can be used now. When it cannot, detail says why
	// in words for the UI ("Bluetooth is off").
	power() (on bool, detail string)
	// enable readies the adapter. Called before every connect attempt and scan; the
	// real one does the work once and then returns nil.
	enable() error
	// held lists the Spark Control X pedals macOS already holds a connection to. They
	// are not advertising, so a scan would miss them. Each has System set.
	held() ([]Device, error)
	// scan calls visit for each advertisement for at most timeout, or until ctx is
	// done; visit returning true stops it early. visit may run on CoreBluetooth's
	// thread: it must be cheap.
	scan(ctx context.Context, timeout time.Duration, visit func(Device) bool) error
	// dial connects to the pedal at addr by identifier, discovers its services and
	// subscribes, delivering notifications and the eventual drop to s. timeout 0 is
	// the adapter's default.
	dial(ctx context.Context, addr string, timeout time.Duration, s sink) (conn, error)
}

// conn is one connected pedal.
type conn interface {
	// write sends one message on FFC9, with response. One at a time: the session's
	// writer goroutine is the only caller.
	write(b []byte) error
	// close hangs up. Drops after close are not reported.
	close()
}

// sink receives what a connected pedal sends. Every method may run on CoreBluetooth's
// callback thread, so none of them block.
type sink interface {
	switches(b []byte) // the switch characteristic: one byte, the held mask
	command(b []byte)  // an FFCA notification
	battery(level int) // the standard Battery Service, 0..100
	dropped()          // the link went away
}

// batteryLevel reads a GATT Battery Level value: one byte, 0..100. A longer value keeps
// its first byte; an empty or out-of-range one is no reading.
func batteryLevel(v []byte) (int, bool) {
	if len(v) == 0 || v[0] > 100 {
		return 0, false
	}
	return int(v[0]), true
}
