//go:build linux

package ble

import (
	"context"
	"errors"
	"fmt"
	"log"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/godbus/dbus/v5"
	"tinygo.org/x/bluetooth"
)

// THE LINUX RADIO: tinygo-bluetooth on BlueZ, plus a few direct D-Bus calls for what
// tinygo does not cover. UNTESTED ON HARDWARE: it builds and its pure part (bluez.go)
// is unit-tested, but nobody has run it against a real pedal yet.
//
// tinygo's Linux Adapter talks to bluetoothd over the shared system bus connection. This
// radio keeps a private connection of its own (rbus) for three things tinygo lacks:
//
//   - power: which adapter exists and whether it is on, with words for each way it can
//     fail (bluetoothd not running, no adapter, rfkill, the D-Bus policy);
//   - held: pedals BlueZ has connected already (Device1.Connected), which do not
//     advertise and so never show up in a scan;
//   - drops: tinygo only calls its connect handler for its own Connect and Disconnect,
//     never when the link goes away by itself, so each connection watches its device's
//     Connected property here.
//
// A private connection, so the match rules and signal channels added here never reach
// tinygo's channels or the tray's (both of which read every signal their connection
// receives).

// bluezDialWait is how long a connect may take before the loop gives up on it when the
// caller sets no budget: BlueZ's own LE connect attempt gives up after about 20 s and
// D-Bus calls time out at 25 s.
const bluezDialWait = 20 * time.Second

type bluezRadio struct {
	mu      sync.Mutex
	rbus    *dbus.Conn // private system bus connection; nil until first used, redialled if lost
	adapter *bluetooth.Adapter
	ad      bluezAdapterInfo // the adapter enable() set up
}

func newRadio() radio { return &bluezRadio{} }

var errNoAdapter = errors.New("no Bluetooth adapter found")

// bus is the private system bus connection, dialled on first use and again after it dropped
// (dbus-daemon restarted).
func (r *bluezRadio) bus() (*dbus.Conn, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.rbus != nil && r.rbus.Connected() {
		return r.rbus, nil
	}
	c, err := dbus.ConnectSystemBus()
	if err != nil {
		return nil, err
	}
	r.rbus = c
	return c, nil
}

// objects is everything BlueZ knows: adapters, devices, services.
func (r *bluezRadio) objects() (bluezObjects, error) {
	c, err := r.bus()
	if err != nil {
		return nil, err
	}
	var objs bluezObjects
	err = c.Object(bluezService, "/").Call("org.freedesktop.DBus.ObjectManager.GetManagedObjects", 0).Store(&objs)
	return objs, err
}

func (r *bluezRadio) power() (bool, string) {
	objs, err := r.objects()
	if err != nil {
		return false, busErrorDetail(err)
	}
	a, ok := pickAdapter(objs)
	if !ok {
		return false, detailNoAdapter
	}
	return adapterDetail(a)
}

// enable readies tinygo's adapter for the adapter BlueZ offers, again whenever that
// changes (a USB dongle replugged as hci1).
func (r *bluezRadio) enable() error {
	objs, err := r.objects()
	if err != nil {
		return errors.New(busErrorDetail(err))
	}
	a, ok := pickAdapter(objs)
	if !ok {
		return errNoAdapter
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.adapter != nil && r.ad.Path == a.Path {
		return nil
	}
	ad := bluetooth.NewAdapter(a.ID)
	if err := ad.Enable(); err != nil {
		return err
	}
	r.adapter, r.ad = ad, a
	log.Printf("ble: using BlueZ adapter %s", a.ID)
	return nil
}

// current is the enabled adapter and its info.
func (r *bluezRadio) current() (*bluetooth.Adapter, bluezAdapterInfo, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.adapter == nil {
		return nil, bluezAdapterInfo{}, errors.New("bluetooth adapter not enabled")
	}
	return r.adapter, r.ad, nil
}

// held lists the pedals BlueZ has connected now, whoever connected them.
func (r *bluezRadio) held() ([]Device, error) {
	objs, err := r.objects()
	if err != nil {
		return nil, errors.New(busErrorDetail(err))
	}
	a, ok := pickAdapter(objs)
	if !ok {
		return nil, errNoAdapter
	}
	return heldPedals(objs, a.Path), nil
}

// scan runs one adapter scan (runScan has the rules). tinygo's BlueZ scan also reports
// the devices already connected, first; Manager.Scan merges them with held().
func (r *bluezRadio) scan(ctx context.Context, timeout time.Duration, visit func(Device) bool) error {
	ad, _, err := r.current()
	if err != nil {
		return err
	}
	return runScan(ctx, timeout, func(found func(Device)) error {
		return ad.Scan(func(_ *bluetooth.Adapter, res bluetooth.ScanResult) {
			found(Device{Name: res.LocalName(), Address: res.Address.String(), RSSI: int(res.RSSI)})
		})
	}, ad.StopScan, visit)
}

// dial connects to the pedal with MAC address addr. BlueZ can only connect a device it
// knows: one seen in a scan since bluetoothd started, or paired. Otherwise the device
// object does not exist, this fails at once, and find.go goes on to scan.
func (r *bluezRadio) dial(ctx context.Context, addr string, timeout time.Duration, s sink) (conn, error) {
	ad, info, err := r.current()
	if err != nil {
		return nil, err
	}
	var a bluetooth.Address
	a.Set(addr)
	if !strings.EqualFold(a.String(), addr) {
		return nil, fmt.Errorf("bad address %q", addr)
	}
	path := devicePath(info.Path, addr)
	bus, err := r.bus()
	if err != nil {
		return nil, errors.New(busErrorDetail(err))
	}
	// Was it connected before us? Then someone else holds it (another app, or BlueZ
	// itself), and hanging up must not take the link from them.
	var already bool
	if v, err := bus.Object(bluezService, path).GetProperty(bluezDevice + ".Connected"); err == nil {
		already, _ = v.Value().(bool)
	}
	// Watch before connecting, so a drop right after the connect is not missed.
	w, err := watchDevice(bus, path, s)
	if err != nil {
		return nil, fmt.Errorf("watch %s: %w", path, err)
	}

	wait := bluezDialWait
	if timeout > 0 {
		wait = timeout
	}
	type result struct {
		dev bluetooth.Device
		err error
	}
	ch := make(chan result, 1)
	go func() {
		dev, err := ad.Connect(a, bluetooth.ConnectionParams{})
		ch <- result{dev, err}
	}()
	hangUpLate := func() { // should it connect after all, nobody holds it
		go func() {
			if res := <-ch; res.err == nil && !already {
				_ = res.dev.Disconnect()
			}
		}()
	}
	t := time.NewTimer(wait + dialGraceLinux)
	defer t.Stop()
	var dev bluetooth.Device
	select {
	case res := <-ch:
		if res.err != nil {
			w.stop()
			return nil, res.err
		}
		dev = res.dev
	case <-t.C:
		w.stop()
		hangUpLate()
		return nil, errors.New("connect timed out")
	case <-ctx.Done():
		w.stop()
		hangUpLate()
		return nil, ctx.Err()
	}
	c := &bzConn{dev: dev, w: w, g: pedalGATT{s: s}, keepLink: already}
	if err := c.g.setup(dev); err != nil {
		log.Printf("ble: setup failed, hanging up: %v", err)
		c.close()
		return nil, err
	}
	w.arm()
	// Gone between the connect and arming the watch? Then report it now.
	if ok, err := dev.Connected(); err == nil && !ok {
		w.fire()
	}
	if already {
		log.Printf("ble: %s was already connected to this computer; it stays connected when Flintstep lets go", addr)
	}
	return c, nil
}

// dialGraceLinux is how long past its budget a connect may take to report back before
// the loop stops waiting for it.
const dialGraceLinux = 3 * time.Second

type bzConn struct {
	dev      bluetooth.Device
	w        *deviceWatch
	g        pedalGATT
	keepLink bool // connected before we came: unsubscribe, but leave the link up
}

func (c *bzConn) write(b []byte) error { return c.g.write(b) }

// close hangs up: the drop watch first, so our own disconnect is not reported, then the
// subscriptions (BlueZ keeps each one, with a goroutine in tinygo, until told), then
// the link itself unless someone else held it before us.
func (c *bzConn) close() {
	c.w.stop()
	c.g.unsubscribe()
	if !c.keepLink {
		_ = c.dev.Disconnect()
	}
}

// unsubscribe ends every subscription notify made. Errors are ignored: after a drop
// the peripheral is gone and there is nothing left to tell it.
func (g *pedalGATT) unsubscribe() {
	g.mu.Lock()
	defer g.mu.Unlock()
	g.closed = true
	for _, ch := range g.subs {
		_ = ch.EnableNotifications(nil)
	}
	g.subs = nil
}

// deviceWatch reports a device's disconnect to a sink, once, after arm.
type deviceWatch struct {
	bus   *dbus.Conn
	path  dbus.ObjectPath
	s     sink
	ch    chan *dbus.Signal
	opts  [][]dbus.MatchOption
	armed atomic.Bool
	once  sync.Once // fire
	stopO sync.Once
	done  chan struct{}
}

func watchDevice(bus *dbus.Conn, path dbus.ObjectPath, s sink) (*deviceWatch, error) {
	w := &deviceWatch{
		bus: bus, path: path, s: s,
		ch:   make(chan *dbus.Signal, 16),
		done: make(chan struct{}),
		opts: [][]dbus.MatchOption{
			{dbus.WithMatchObjectPath(path), dbus.WithMatchInterface(dbusProperties), dbus.WithMatchMember("PropertiesChanged")},
			{dbus.WithMatchSender(bluezService), dbus.WithMatchInterface("org.freedesktop.DBus.ObjectManager"), dbus.WithMatchMember("InterfacesRemoved")},
		},
	}
	for i, o := range w.opts {
		if err := bus.AddMatchSignal(o...); err != nil {
			for _, added := range w.opts[:i] {
				_ = bus.RemoveMatchSignal(added...)
			}
			return nil, err
		}
	}
	bus.Signal(w.ch)
	go w.run()
	return w, nil
}

func (w *deviceWatch) run() {
	for {
		select {
		case <-w.done:
			return
		case sig, ok := <-w.ch:
			if !ok { // the bus connection died: the link's state is unknown, call it gone
				w.fire()
				return
			}
			if deviceGone(sig, w.path) {
				w.fire()
			}
		}
	}
}

// arm starts reporting: drops before it (during the connect) are the dial's to handle.
func (w *deviceWatch) arm() { w.armed.Store(true) }

func (w *deviceWatch) fire() {
	if !w.armed.Load() {
		return
	}
	select {
	case <-w.done:
		return // stopped: a drop after close is not reported
	default:
	}
	w.once.Do(w.s.dropped)
}

func (w *deviceWatch) stop() {
	w.stopO.Do(func() {
		close(w.done)
		w.bus.RemoveSignal(w.ch)
		for _, o := range w.opts {
			_ = w.bus.RemoveMatchSignal(o...)
		}
	})
}
