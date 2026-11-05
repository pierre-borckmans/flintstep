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

// THE REAL RADIO: tinygo-bluetooth on CoreBluetooth. From Beam's ble.go, blehub.go and
// blesystem_darwin.go.
//
// Three things on tinygo's Adapter are global: Enable may only be in progress once,
// there is ONE connect handler for every device, and ONE scan at a time. cbRadio owns
// all three: enable runs until it succeeds once, the connect handler routes a drop to
// the sink of the pedal at that address, and the Manager serialises scans (find.go).

// midiService is the BLE-MIDI service, which the Spark Control X advertises too.
const midiService = "03B80E5A-EDE8-4B33-A751-6CE34EC4C700"

// batteryService and batteryLevelChar are the standard GATT Battery Service.
const (
	batteryService   uint16 = 0x180F
	batteryLevelChar uint16 = 0x2A19
)

// powerService and powerChar push the USB power state: 01 on USB, 00 on battery
// (docs/PROTOCOL-NOTES.md). Read + notify.
const (
	powerService = "6FACFE71-A4C3-4E80-BA5C-533928830727"
	powerChar    = "90D9A098-9CD8-4A7A-B176-91FFE80909F2"
)

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

// enable turns the adapter on and installs the connect handler. Unlike Beam it retries
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
	c := &cbConn{r: r, dev: dev, key: key, s: s}
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
	tx  bluetooth.DeviceCharacteristic
}

// setup discovers the pedal's services and subscribes. From Beam's sparkx_ble.go.
func (c *cbConn) setup() error {
	swSvc, err := bluetooth.ParseUUID(sparkx.SwitchService)
	if err != nil {
		return err
	}
	swChar, err := bluetooth.ParseUUID(sparkx.SwitchChar)
	if err != nil {
		return err
	}
	cmdSvc := bluetooth.New16BitUUID(sparkx.CommandSvc)
	pwrSvc, err := bluetooth.ParseUUID(powerService)
	if err != nil {
		return err
	}
	// One discovery for everything: tinygo clears its cache on each, so a second one
	// later could cost the first its notifications. tinygo also fails the whole call
	// when any asked-for service is missing, so findServices falls back to asking for
	// every service and picking ours out: the battery and power services are optional.
	svcs, opt, err := findServices(
		[]bluetooth.UUID{swSvc, cmdSvc},
		[]bluetooth.UUID{bluetooth.New16BitUUID(batteryService), pwrSvc},
		c.dev.DiscoverServices,
		bluetooth.DeviceService.UUID)
	if err != nil {
		return fmt.Errorf("discover Spark Control X services: %w", err)
	}
	battSvc, powerSvc := opt[0], opt[1]
	sw, err := svcs[0].DiscoverCharacteristics([]bluetooth.UUID{swChar})
	if err != nil || len(sw) == 0 {
		return fmt.Errorf("discover the switch characteristic: %w", err)
	}
	cmd, err := svcs[1].DiscoverCharacteristics([]bluetooth.UUID{
		bluetooth.New16BitUUID(sparkx.CommandTx), bluetooth.New16BitUUID(sparkx.CommandRx)})
	if err != nil || len(cmd) < 2 {
		return fmt.Errorf("discover the command characteristics: %w", err)
	}
	c.tx = cmd[0]
	if err := sw[0].EnableNotifications(c.s.switches); err != nil {
		return fmt.Errorf("enable switch notifications: %w", err)
	}
	if err := cmd[1].EnableNotifications(c.s.command); err != nil {
		return fmt.Errorf("enable command notifications: %w", err)
	}
	// The optional characteristics one after the other: tinygo's characteristic
	// discovery shares one channel per device, so two at once could swap answers.
	go func() {
		if battSvc != nil {
			c.watchBattery(*battSvc)
		}
		if powerSvc != nil {
			c.watchPower(*powerSvc)
		}
	}()
	return nil
}

// watchPower reads the USB power characteristic once and subscribes to its changes
// (~1 s after the cable goes in or out). Any failure only means no reading from it: the
// 0x11 request on FFC9 covers that.
func (c *cbConn) watchPower(svc bluetooth.DeviceService) {
	id, err := bluetooth.ParseUUID(powerChar)
	if err != nil {
		return
	}
	chars, err := svc.DiscoverCharacteristics([]bluetooth.UUID{id})
	if err != nil || len(chars) == 0 {
		log.Printf("ble: power service without its characteristic: %v", err)
		return
	}
	ch := chars[0]
	buf := make([]byte, 8)
	if n, err := ch.Read(buf); err != nil {
		log.Printf("ble: power read failed: %v", err)
	} else if on, ok := usbPower(buf[:n]); ok {
		c.s.power(on)
	}
	err = ch.EnableNotifications(func(v []byte) {
		if on, ok := usbPower(v); ok {
			c.s.power(on)
		}
	})
	if err != nil {
		log.Printf("ble: power notifications unavailable: %v", err)
	}
}

// watchBattery reads the Battery Level once and subscribes to its changes. Any failure
// only means no reading from it: the FFCA battery poll covers that.
func (c *cbConn) watchBattery(svc bluetooth.DeviceService) {
	chars, err := svc.DiscoverCharacteristics([]bluetooth.UUID{bluetooth.New16BitUUID(batteryLevelChar)})
	if err != nil || len(chars) == 0 {
		log.Printf("ble: battery service without a level: %v", err)
		return
	}
	ch := chars[0]
	buf := make([]byte, 8)
	if n, err := ch.Read(buf); err != nil {
		log.Printf("ble: battery read failed: %v", err)
	} else if level, ok := batteryLevel(buf[:n]); ok {
		c.s.battery(level)
	}
	err = ch.EnableNotifications(func(v []byte) {
		if level, ok := batteryLevel(v); ok {
			c.s.battery(level)
		}
	})
	if err != nil {
		log.Printf("ble: battery notifications unavailable: %v", err)
	}
}

func (c *cbConn) write(b []byte) error {
	_, err := c.tx.Write(b)
	return err
}

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
