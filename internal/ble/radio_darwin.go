//go:build darwin

package ble

import (
	"context"
	"errors"
	"fmt"
	"log"
	"strings"
	"sync"
	"time"

	"github.com/tinygo-org/cbgo"
	"tinygo.org/x/bluetooth"

	"flintstep/internal/product"
	"flintstep/internal/sparkx"
)

// THE REAL RADIO: tinygo-bluetooth on CoreBluetooth. From the BEAM Mini app's ble.go, blehub.go and
// blesystem_darwin.go.
//
// Three things on tinygo's Adapter are global: Enable may only be in progress once,
// there is ONE connect handler for every device, and ONE scan at a time. cbRadio owns
// all three: enable runs until it succeeds once, the connect handler routes a drop to
// the sink of the pedal at that address, and the Manager serialises scans (find.go).

// The service UUIDs, the GATT setup and the FFC9 writes are gatt_tinygo.go's, shared with
// the Linux radio.

type cbRadio struct {
	adapter *bluetooth.Adapter

	mu      sync.Mutex
	enabled bool

	sinks sync.Map // address (as tinygo spells it) -> sink
}

func newRadio() radio { return &cbRadio{adapter: bluetooth.DefaultAdapter} }

func (r *cbRadio) power() (bool, string) {
	st, err := systemState()
	if err != nil {
		return false, "Bluetooth is starting"
	}
	switch st {
	case cbgo.ManagerStatePoweredOn:
		return true, ""
	case cbgo.ManagerStatePoweredOff:
		return false, "Bluetooth is off"
	case cbgo.ManagerStateUnauthorized:
		return false, "Bluetooth access is not allowed: turn it on for " + product.Name + " in System Settings > Privacy & Security > Bluetooth"
	case cbgo.ManagerStateUnsupported:
		return false, "This Mac has no Bluetooth LE"
	}
	return false, "Bluetooth is starting"
}

// enable turns the adapter on and installs the connect handler. Unlike the BEAM Mini app it retries
// after a failure: Bluetooth may come on later, and tinygo clears its own state on a
// failed Enable so a second one can run.
func (r *cbRadio) enable() error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.enabled {
		return nil
	}
	if err := r.adapter.Enable(); err != nil {
		return err
	}
	r.enabled = true
	r.adapter.SetConnectHandler(func(d bluetooth.Device, connected bool) {
		if connected {
			return // Connect's own return value is the success path
		}
		if s, ok := r.sinks.Load(d.Address.String()); ok {
			s.(sink).dropped()
		}
	})
	return nil
}

func (r *cbRadio) held() ([]Device, error) {
	return systemPedals()
}

// scan runs one adapter scan (runScan has the rules).
func (r *cbRadio) scan(ctx context.Context, timeout time.Duration, visit func(Device) bool) error {
	return runScan(ctx, timeout, func(found func(Device)) error {
		return r.adapter.Scan(func(_ *bluetooth.Adapter, res bluetooth.ScanResult) {
			found(Device{Name: res.LocalName(), Address: res.Address.String(), RSSI: int(res.RSSI)})
		})
	}, r.adapter.StopScan, visit)
}

// defaultDialWait is tinygo's own connect timeout (gap_darwin.go), and dialGrace how
// long past it a connect may take to report that it gave up: tinygo waits for
// CoreBluetooth to confirm the cancel, and should that never come (Bluetooth turned
// off mid-connect) the loop must not hang with it.
const (
	defaultDialWait = 10 * time.Second
	dialGrace       = 3 * time.Second
	maxDial         = 40 * time.Second // tinygo's timeout is a uint16 count of 625 µs
)

// dial connects by identifier: CoreBluetooth resolves the address with
// retrievePeripheralsWithIdentifiers, which needs no advertisement, so this reaches a
// pedal the Mac already holds as well as one advertising now.
func (r *cbRadio) dial(ctx context.Context, addr string, timeout time.Duration, s sink) (conn, error) {
	var a bluetooth.Address
	a.Set(addr)
	if !strings.EqualFold(a.String(), addr) {
		return nil, fmt.Errorf("bad address %q", addr)
	}
	params := bluetooth.ConnectionParams{}
	wait := defaultDialWait
	if timeout > 0 {
		timeout = min(timeout, maxDial)
		params.ConnectionTimeout = bluetooth.NewDuration(timeout)
		wait = timeout
	}
	type result struct {
		dev bluetooth.Device
		err error
	}
	ch := make(chan result, 1)
	go func() {
		dev, err := r.adapter.Connect(a, params)
		ch <- result{dev, err}
	}()
	hangUpLate := func() { // should it connect after all, nobody holds it
		go func() {
			if res := <-ch; res.err == nil {
				_ = res.dev.Disconnect()
			}
		}()
	}
	t := time.NewTimer(wait + dialGrace)
	defer t.Stop()
	var dev bluetooth.Device
	select {
	case res := <-ch:
		if res.err != nil {
			return nil, res.err
		}
		dev = res.dev
	case <-t.C:
		hangUpLate()
		return nil, errors.New("connect timed out")
	case <-ctx.Done():
		hangUpLate()
		return nil, ctx.Err()
	}
	key := a.String()
	r.sinks.Store(key, s)
	c := &cbConn{r: r, dev: dev, key: key, s: s, g: pedalGATT{s: s}}
	// Past this point a failure must hang up, or the pedal stays connected to us with
	// nobody holding it.
	if err := c.setup(); err != nil {
		log.Printf("ble: setup failed, hanging up: %v", err)
		c.close()
		return nil, err
	}
	return c, nil
}

type cbConn struct {
	r   *cbRadio
	dev bluetooth.Device
	key string
	s   sink
	g   pedalGATT
}

// setup discovers the pedal's services and subscribes (gatt_tinygo.go).
func (c *cbConn) setup() error { return c.g.setup(c.dev) }

func (c *cbConn) write(b []byte) error { return c.g.write(b) }

// close hangs up. When macOS holds the pedal too, this only drops this app's claim.
func (c *cbConn) close() {
	c.r.sinks.CompareAndDelete(c.key, c.s)
	_ = c.dev.Disconnect()
}

// PEDALS THE MAC ALREADY HOLDS.
//
// A connected peripheral stops advertising, so a scan never sees it. CoreBluetooth
// answers "what is connected to this Mac and offers this service" with
// retrieveConnectedPeripheralsWithServices, and the identifier it returns is the one
// Adapter.Connect resolves, so such a pedal can be connected straight away.
//
// tinygo's Adapter keeps its manager unexported, so this is a second CBCentralManager.
// It never scans and never connects, so it cannot disturb the adapter's connections.
// It also answers whether Bluetooth is on.

const systemQueryWait = 3 * time.Second

var sysBT struct {
	once sync.Once
	cm   cbgo.CentralManager
	dlg  *sysDelegate
}

type sysDelegate struct {
	cbgo.CentralManagerDelegateBase
	changed chan struct{}
}

func (d *sysDelegate) CentralManagerDidUpdateState(cbgo.CentralManager) {
	select {
	case d.changed <- struct{}{}:
	default:
	}
}

var errUnknownState = errors.New("bluetooth state not known yet")

// systemState is the system manager's state, waiting a little for the first one.
func systemState() (cbgo.ManagerState, error) {
	sysBT.once.Do(func() {
		sysBT.dlg = &sysDelegate{changed: make(chan struct{}, 1)}
		sysBT.cm = cbgo.NewCentralManager(nil)
		sysBT.cm.SetDelegate(sysBT.dlg)
	})
	deadline := time.NewTimer(systemQueryWait)
	defer deadline.Stop()
	for {
		st := sysBT.cm.State()
		if st != cbgo.ManagerStateUnknown && st != cbgo.ManagerStateResetting {
			return st, nil
		}
		select {
		case <-sysBT.dlg.changed:
		case <-deadline.C:
			return st, errUnknownState
		}
	}
}

// systemPedals lists the Spark Control X pedals connected to this Mac now, by anyone.
func systemPedals() ([]Device, error) {
	st, err := systemState()
	if err != nil {
		return nil, err
	}
	if st != cbgo.ManagerStatePoweredOn {
		return nil, errors.New("bluetooth is not powered on")
	}
	var uuids []cbgo.UUID
	for _, s := range []string{sparkx.SwitchService, midiService} {
		u, err := cbgo.ParseUUID(s)
		if err != nil {
			return nil, err
		}
		uuids = append(uuids, u)
	}
	var out []Device
	for _, p := range sysBT.cm.RetrieveConnectedPeripheralsWithServices(uuids) {
		if !sparkx.IsName(p.Name()) {
			continue
		}
		// Through tinygo's UUID, so the address is spelled exactly as a scan spells it.
		id, err := bluetooth.ParseUUID(p.Identifier().String())
		if err != nil {
			continue
		}
		out = append(out, Device{Name: p.Name(), Address: id.String(), System: true})
	}
	return out, nil
}
