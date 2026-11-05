package ble

import (
	"context"
	"fmt"
	"sync"
	"time"
)

// THE RADIO SEAM.
//
// Everything the Manager needs from the OS's Bluetooth stack goes through radio, so the
// connect path, the reconnect loop and the pedal session are all tested with a fake
// (fake_test.go). A port to a new OS implements radio and newRadio() in radio_<os>.go:
//
//	radio_darwin.go  CoreBluetooth, through tinygo-bluetooth and cbgo
//	radio_linux.go   BlueZ over the system D-Bus, through tinygo-bluetooth and godbus
//	radio_other.go   everywhere else: Bluetooth reads as unavailable, the Manager sits
//	                 in StateOff, and the package still builds and tests
//
// The tinygo-based radios share the GATT side (gatt_tinygo.go). Addresses are whatever
// the OS identifies a peripheral by: a CoreBluetooth UUID on macOS, a MAC address on
// Linux. The remembered pedal is therefore per OS; a pedal remembered on one is simply
// not found by address on the other, and the name fallback takes over.

// midiService is the BLE-MIDI service, which the Spark Control X advertises too. The
// radios use it with the switch service to recognise a pedal the system already holds.
const midiService = "03B80E5A-EDE8-4B33-A751-6CE34EC4C700"

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
	power(on bool)     // the USB power characteristic: true on USB power
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

// findServices discovers the required services and whichever optional ones the pedal
// has. tinygo fails a whole discovery when any asked-for service is missing, and clears
// its cache on each one. So one discovery asks for everything, and only when that fails
// a second asks for every service the pedal has (nil), from which ours are picked out:
// two discoveries at most, whatever is missing. opt[i] is nil when optional[i] is absent.
func findServices[U comparable, S any](required, optional []U, discover func([]U) ([]S, error), id func(S) U) (req []S, opt []*S, err error) {
	ids := append(append([]U(nil), required...), optional...)
	opt = make([]*S, len(optional))
	svcs, err := discover(ids)
	if err == nil && len(svcs) == len(ids) {
		for i := range optional {
			opt[i] = &svcs[len(required)+i]
		}
		return svcs[:len(required)], opt, nil
	}
	all, err := discover(nil)
	if err != nil {
		return nil, nil, err
	}
	byID := make(map[U]S, len(all))
	for _, s := range all {
		byID[id(s)] = s
	}
	req = make([]S, len(required))
	for i, u := range required {
		s, ok := byID[u]
		if !ok {
			return nil, nil, fmt.Errorf("service %v missing", u)
		}
		req[i] = s
	}
	for i, u := range optional {
		if s, ok := byID[u]; ok {
			opt[i] = &s
		}
	}
	return req, opt, nil
}

// usbPower reads the USB power characteristic (90D9A098-...): 01 on USB power, 00 on
// battery. A longer value keeps its first byte; anything else is no reading.
func usbPower(v []byte) (on, ok bool) {
	if len(v) == 0 || v[0] > 1 {
		return false, false
	}
	return v[0] == 1, true
}

// runScan runs one adapter scan the way tinygo's Adapter wants it: start blocks until
// stopScan is called, and stopScan hands a value to the scanning goroutine, which only
// ever reads one: calling it twice (a match and the timeout landing together) would
// block forever, so the first caller wins. stopScan fails until start has set the scan
// up, so a stop that comes first (ctx already done) keeps trying until it lands or the
// scan ends: given up, it would leave the scan running forever.
func runScan(ctx context.Context, timeout time.Duration, start func(found func(Device)) error, stopScan func() error, visit func(Device) bool) error {
	done := make(chan struct{})
	var stopOnce sync.Once
	stop := func() {
		stopOnce.Do(func() {
			for stopScan() != nil {
				select {
				case <-done:
					return
				case <-time.After(5 * time.Millisecond):
				}
			}
		})
	}
	var scanErr error
	go func() {
		scanErr = start(func(d Device) {
			if visit(d) {
				stop()
			}
		})
		close(done)
	}()
	t := time.NewTimer(timeout)
	defer t.Stop()
	select {
	case <-done:
	case <-t.C:
		stop()
		<-done
	case <-ctx.Done():
		stop()
		<-done
	}
	return scanErr
}
