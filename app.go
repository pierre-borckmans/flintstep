package main

import (
	"context"
	"errors"
	"fmt"
	"log"
	"os/exec"
	"path/filepath"
	"sync"
	"time"

	"github.com/wailsapp/wails/v2/pkg/runtime"

	"sparkbridge/internal/ble"
	"sparkbridge/internal/bridge"
	"sparkbridge/internal/coremidi"
	"sparkbridge/internal/loginitem"
	"sparkbridge/internal/mapping"
	"sparkbridge/internal/store"
	"sparkbridge/internal/tray"
)

// Names other apps see.
const (
	midiClient = "SparkX MIDI"
	midiSource = "Spark Control X"
	midiDest   = "Spark Control X LEDs"
)

// stateEvery is the most often the UI is sent a fresh State: the pedal's status can
// change at 20 Hz while an expression pedal moves.
const stateEvery = 50 * time.Millisecond

// MIDIState is the virtual port, as the UI shows it.
type MIDIState struct {
	Source string `json:"source"`
	Dest   string `json:"dest"`
	OK     bool   `json:"ok"`
	Error  string `json:"error"`
}

// State is everything the UI draws.
type State struct {
	Pedal         ble.Status     `json:"pedal"`
	Config        mapping.Config `json:"config"`
	MIDI          MIDIState      `json:"midi"`
	LaunchAtLogin bool           `json:"launchAtLogin"`
	Version       string         `json:"version"`
}

// App is bound to the frontend: its exported methods are the UI's API.
type App struct {
	ctx context.Context

	dir    string
	cfgMu  sync.Mutex // serialises config writes
	bridge *bridge.Bridge
	pedal  *ble.Manager
	midi   *coremidi.Virtual
	mstate MIDIState

	dirty    chan struct{}
	stopOnce sync.Once
	stop     chan struct{}

	emitMu sync.RWMutex // emit reads quiet; shutdown sets it
	quiet  bool
	emitTo func(name string, data any) // Wails' EventsEmit; tests replace it
}

func NewApp() *App {
	a := &App{dirty: make(chan struct{}, 1), stop: make(chan struct{})}
	a.emitTo = func(name string, data any) { runtime.EventsEmit(a.ctx, name, data) }
	return a
}

// emit sends an event to the UI, unless shutdown has begun: by then Wails has
// released the window, and a late emit would queue JS for it on the main thread.
func (a *App) emit(name string, data any) {
	a.emitMu.RLock()
	defer a.emitMu.RUnlock()
	if !a.quiet {
		a.emitTo(name, data)
	}
}

func (a *App) cfgPath() string { return filepath.Join(a.dir, "config.json") }

func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
	dir, err := store.Dir()
	if err != nil {
		log.Printf("no data dir: %v", err)
	}
	a.dir = dir
	startLog(filepath.Join(dir, "app.log"))

	cfg, err := store.Load(a.cfgPath())
	if err != nil {
		log.Printf("config: %v (using defaults)", err)
	}

	a.mstate = MIDIState{Source: midiSource, Dest: midiDest}
	a.bridge = bridge.New(cfg, nil, bridge.Options{
		OnActivity: func(ev bridge.Activity) { a.emit("activity", ev) },
		OnStatus:   func(ble.Status) { a.changed() },
	})
	v, err := coremidi.NewVirtual(midiClient, midiSource, midiDest, a.bridge.Feedback)
	if err != nil {
		log.Printf("midi: %v", err)
		a.mstate.Error = err.Error()
	} else {
		a.midi = v
		a.mstate.OK = true
		a.bridge.SetOut(v)
		log.Printf("midi: virtual source %q and destination %q up", midiSource, midiDest)
	}

	a.pedal = ble.NewManager(a.bridge.Handlers(), filepath.Join(dir, "ble-trace.log"))
	a.bridge.SetPedal(a.pedal)
	a.pedal.OnConnected(a.remember)
	a.pedal.Start(target(cfg.Pedal))

	tray.Start(tray.Icon, a.onTray)
	go a.stateLoop()
	a.changed()
}

func (a *App) shutdown(context.Context) {
	// No events from here on: an emit in flight finishes first.
	a.emitMu.Lock()
	a.quiet = true
	a.emitMu.Unlock()
	a.stopOnce.Do(func() { close(a.stop) })
	if a.pedal != nil {
		a.pedal.Stop() // lamps dark first: the pedal should not keep showing our state
	}
	if a.bridge != nil {
		a.bridge.Close()
	}
	if a.midi != nil {
		a.midi.Close()
	}
	log.Printf("---- SparkX MIDI stopped ----")
}

func target(p mapping.PedalRef) ble.Target {
	return ble.Target{Address: p.Address, Name: p.Name}
}

// remember makes the pedal we just connected to the one we look for next time.
func (a *App) remember(d ble.Device) {
	a.cfgMu.Lock()
	defer a.cfgMu.Unlock()
	cfg := a.bridge.Config()
	if cfg.Pedal.Address == d.Address && cfg.Pedal.Name == d.Name {
		return
	}
	cfg.Pedal = mapping.PedalRef{Address: d.Address, Name: d.Name}
	if _, err := a.bridge.Apply(cfg); err != nil {
		log.Printf("config: %v", err)
		return
	}
	if err := store.Save(a.cfgPath(), cfg); err != nil {
		log.Printf("config: save: %v", err)
	}
	a.changed()
}

// changed asks for a State to be sent to the UI soon.
func (a *App) changed() {
	select {
	case a.dirty <- struct{}{}:
	default:
	}
}

// stateLoop sends State to the UI and refreshes the menu-bar menu, at most every
// stateEvery.
func (a *App) stateLoop() {
	for {
		select {
		case <-a.stop:
			return
		case <-a.dirty:
		}
		st := a.GetState()
		a.emit("state", st)
		a.updateTray(st)
		select {
		case <-a.stop:
			return
		case <-time.After(stateEvery):
		}
	}
}

// ---- bound methods ----

// GetState is everything the UI draws.
func (a *App) GetState() State {
	return State{
		Pedal:         a.pedal.Status(),
		Config:        a.bridge.Config(),
		MIDI:          a.mstate,
		LaunchAtLogin: loginitem.Enabled(),
		Version:       version,
	}
}

// SaveConfig validates, applies and stores a mapping. The pedal it remembers is kept
// from the current config: the UI does not own that field.
func (a *App) SaveConfig(cfg mapping.Config) error {
	a.cfgMu.Lock()
	defer a.cfgMu.Unlock()
	cfg.Pedal = a.bridge.Config().Pedal
	applied, err := a.bridge.Apply(cfg)
	if err != nil {
		return err
	}
	defer a.changed()
	return store.Save(a.cfgPath(), applied)
}

// ResetConfig puts the default mapping back, keeping the remembered pedal.
func (a *App) ResetConfig() (mapping.Config, error) {
	cfg := mapping.Default()
	if err := a.SaveConfig(cfg); err != nil {
		return a.bridge.Config(), err
	}
	return a.bridge.Config(), nil
}

// Scan lists the Spark Control X pedals in range or already held by macOS.
func (a *App) Scan() ([]ble.Device, error) {
	ds, err := a.pedal.Scan(4 * time.Second)
	if ds == nil {
		ds = []ble.Device{}
	}
	return ds, err
}

// ChoosePedal makes the bridge connect to this pedal from now on.
func (a *App) ChoosePedal(address, name string) error {
	ref := mapping.PedalRef{Address: address, Name: name}
	if err := a.setPedal(ref); err != nil {
		return err
	}
	a.pedal.SetTarget(target(ref))
	return nil
}

// ForgetPedal goes back to "the first Spark Control X found".
func (a *App) ForgetPedal() error {
	if err := a.setPedal(mapping.PedalRef{}); err != nil {
		return err
	}
	a.pedal.SetTarget(ble.Target{})
	return nil
}

func (a *App) setPedal(ref mapping.PedalRef) error {
	a.cfgMu.Lock()
	defer a.cfgMu.Unlock()
	cfg := a.bridge.Config()
	cfg.Pedal = ref
	applied, err := a.bridge.Apply(cfg)
	if err != nil {
		return err
	}
	defer a.changed()
	return store.Save(a.cfgPath(), applied)
}

// CalibrateExp stores input n's current raw value as its heel ("min") or toe ("max").
func (a *App) CalibrateExp(n int, edge string) (mapping.Config, error) {
	if n < 0 || n > 1 {
		return a.bridge.Config(), fmt.Errorf("no expression input %d", n+1)
	}
	st := a.pedal.Status()
	raw := st.ExpRaw[n]
	if !st.Cables[n] || raw < 0 {
		return a.bridge.Config(), fmt.Errorf("plug an expression pedal into jack %d first", n+1)
	}
	a.cfgMu.Lock()
	cfg := a.bridge.Config()
	switch edge {
	case "min":
		cfg.Exp[n].Min = raw
	case "max":
		cfg.Exp[n].Max = raw
	default:
		a.cfgMu.Unlock()
		return cfg, fmt.Errorf("unknown calibration edge %q", edge)
	}
	// Heel and toe set the wrong way round is a reversed pedal, not an error.
	if cfg.Exp[n].Min > cfg.Exp[n].Max {
		cfg.Exp[n].Min, cfg.Exp[n].Max = cfg.Exp[n].Max, cfg.Exp[n].Min
		cfg.Exp[n].Invert = !cfg.Exp[n].Invert
	}
	if cfg.Exp[n].Min == cfg.Exp[n].Max {
		a.cfgMu.Unlock()
		return a.bridge.Config(), errors.New("heel and toe read the same value; move the pedal and try again")
	}
	a.cfgMu.Unlock()
	if err := a.SaveConfig(cfg); err != nil {
		return a.bridge.Config(), err
	}
	return a.bridge.Config(), nil
}

// SetLaunchAtLogin turns the login item on or off.
func (a *App) SetLaunchAtLogin(on bool) error {
	defer a.changed()
	return loginitem.Set(on)
}

// RevealLogs shows app.log in Finder.
func (a *App) RevealLogs() error {
	return exec.Command("open", "-R", filepath.Join(a.dir, "app.log")).Run()
}

// ---- menu bar ----

func (a *App) onTray(id string) {
	switch id {
	case "open":
		a.showWindow()
	case "login":
		on := !loginitem.Enabled()
		if err := loginitem.Set(on); err != nil {
			log.Printf("login item: %v", err)
		}
		a.changed()
	case "quit":
		runtime.Quit(a.ctx)
	}
}

func (a *App) showWindow() {
	runtime.WindowShow(a.ctx)
	activateApp()
}

func (a *App) updateTray(st State) {
	items := []tray.Item{{ID: "status", Title: statusLine(st.Pedal), Disabled: true}}
	if st.Pedal.State == ble.StateConnected && st.Pedal.Battery >= 0 {
		items = append(items, tray.Item{ID: "battery", Title: fmt.Sprintf("Battery %d%%", st.Pedal.Battery), Disabled: true})
	}
	if !st.MIDI.OK {
		items = append(items, tray.Item{ID: "midi", Title: "MIDI port unavailable", Disabled: true})
	}
	items = append(items,
		tray.Item{Separator: true},
		tray.Item{ID: "open", Title: "Open SparkX MIDI…"},
		tray.Item{ID: "login", Title: "Launch at Login", Checked: st.LaunchAtLogin},
		tray.Item{Separator: true},
		tray.Item{ID: "quit", Title: "Quit SparkX MIDI"},
	)
	tray.SetMenu(items)
	tray.SetTooltip("SparkX MIDI: " + statusLine(st.Pedal))
}

func statusLine(p ble.Status) string {
	switch p.State {
	case ble.StateConnected:
		if p.Name != "" {
			return "Connected to " + p.Name
		}
		return "Connected"
	case ble.StateConnecting:
		return "Connecting…"
	case ble.StateSearching:
		return "Looking for the pedal…"
	case ble.StateOff:
		if p.Detail != "" {
			return p.Detail
		}
		return "Bluetooth is off"
	}
	return "Not connected"
}
