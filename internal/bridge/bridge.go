// Package bridge joins the pedal to the virtual MIDI port.
//
// Pedal events (switch edges, raw expression values, status) come in from the BLE
// manager on its goroutines. The bridge serialises them through one mapping.Engine,
// sends what the engine returns to the virtual MIDI source, and keeps the pedal's lamps
// in step with what the engine says they should show. MIDI arriving on the LED
// destination goes through the same engine, so feedback mode lights the lamps from the
// DAW's real state.
//
// Nothing here touches Bluetooth, CoreMIDI or Wails: the three are behind small
// interfaces, so the whole path from "switch II went down" to "CC 81 = 127 went out and
// lamp II lit" is tested with fakes.
package bridge

import (
	"sync"
	"time"

	"sparkbridge/internal/ble"
	"sparkbridge/internal/mapping"
	"sparkbridge/internal/sparkx"
)

// Pedal is the BLE manager as the bridge uses it.
type Pedal interface {
	SetLamps(l [sparkx.Switches]sparkx.Colour)
	Status() ble.Status
}

// MIDIOut is the virtual MIDI source.
type MIDIOut interface {
	Send(msg []byte) error
}

// Activity is one MIDI message through the bridge, for the UI's log.
type Activity struct {
	Dir   string `json:"dir"` // "out" to apps, "in" from the LED destination
	Bytes []int  `json:"bytes"`
	Label string `json:"label"`
	At    int64  `json:"at"` // unix ms
}

// tickEvery is how often pending long presses and combos are checked. A long press
// lands within this of its threshold, which nobody can feel at 500 ms.
const tickEvery = 10 * time.Millisecond

// Bridge is safe for concurrent use.
type Bridge struct {
	// step serialises each trip from the engine to the outputs: MIDI and lamp states
	// leave in the order the engine produced them. Edges, ticks, feedback, status and
	// Apply arrive on different goroutines; without it a long press fired by the tick
	// loop could reach the DAW after the release that ends it. Taken before mu.
	step  sync.Mutex
	mu    sync.Mutex
	eng   *mapping.Engine
	cfg   mapping.Config
	pedal Pedal
	out   MIDIOut
	lamps [sparkx.Switches]sparkx.Colour
	lit   bool // lamps were sent at least once since the last connect

	now        func() time.Time
	onActivity func(Activity)
	onStatus   func(ble.Status)

	ticking bool
	stop    chan struct{}
	closed  sync.Once
}

// Options are the bridge's callbacks. Both may be nil. OnStatus is called with no lock
// held. OnActivity is called in message order while one step is going through, so it
// must not call back into the bridge.
type Options struct {
	OnActivity func(Activity)
	OnStatus   func(ble.Status)
	// Now is the clock; nil is time.Now. Tests set it.
	Now func() time.Time
}

// New starts a bridge with cfg. Attach the pedal with SetPedal once it exists: the BLE
// manager needs the bridge's Handlers to be built, so the two are wired in that order.
func New(cfg mapping.Config, out MIDIOut, o Options) *Bridge {
	now := o.Now
	if now == nil {
		now = time.Now
	}
	return &Bridge{
		eng:        mapping.NewEngine(cfg),
		cfg:        cfg,
		out:        out,
		now:        now,
		onActivity: o.OnActivity,
		onStatus:   o.OnStatus,
		stop:       make(chan struct{}),
	}
}

// SetPedal attaches the pedal whose lamps the bridge drives.
func (b *Bridge) SetPedal(p Pedal) {
	b.mu.Lock()
	b.pedal = p
	b.mu.Unlock()
}

// SetOut attaches the virtual MIDI source. Until then messages only reach the
// activity log, which keeps the UI useful when CoreMIDI refused the port.
func (b *Bridge) SetOut(out MIDIOut) {
	b.mu.Lock()
	b.out = out
	b.mu.Unlock()
}

// Close stops the tick loop.
func (b *Bridge) Close() { b.closed.Do(func() { close(b.stop) }) }

// Config is the mapping in use.
func (b *Bridge) Config() mapping.Config {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.cfg
}

// Apply switches to a new mapping. It is normalised and validated first; an invalid one
// is refused and the old one stays.
func (b *Bridge) Apply(cfg mapping.Config) (mapping.Config, error) {
	cfg = cfg.Normalize()
	if err := cfg.Validate(); err != nil {
		return b.Config(), err
	}
	b.step.Lock()
	defer b.step.Unlock()
	b.mu.Lock()
	b.cfg = cfg
	b.eng.SetConfig(cfg)
	b.mu.Unlock()
	b.syncLamps()
	return cfg, nil
}

// Handlers are what the BLE manager calls.
func (b *Bridge) Handlers() ble.Handlers {
	return ble.Handlers{
		Switch: b.onSwitch,
		Exp:    b.onExp,
		Status: b.onPedalStatus,
	}
}

func (b *Bridge) onSwitch(e sparkx.Edge) {
	b.step.Lock()
	defer b.step.Unlock()
	b.mu.Lock()
	msgs := b.eng.Switch(e, b.now())
	pending := b.eng.Pending()
	b.mu.Unlock()
	b.send(msgs)
	b.syncLamps()
	if pending {
		b.startTicking()
	}
}

func (b *Bridge) onExp(n, raw int) {
	b.step.Lock()
	defer b.step.Unlock()
	b.mu.Lock()
	msg, ok := b.eng.Exp(n, raw)
	b.mu.Unlock()
	if ok {
		b.send([][]byte{msg})
	}
}

func (b *Bridge) onPedalStatus(st ble.Status) {
	b.step.Lock()
	if st.State != ble.StateConnected {
		b.mu.Lock()
		releases := b.eng.Reset()
		b.lit = false
		b.mu.Unlock()
		b.send(releases)
	} else {
		// A fresh connection starts with lamps unknown: make sure the engine's view is
		// written once, even if it matches what we last sent to the previous link.
		b.mu.Lock()
		first := !b.lit
		b.mu.Unlock()
		if first {
			b.syncLamps()
		}
	}
	b.step.Unlock()
	if b.onStatus != nil {
		b.onStatus(st)
	}
}

// Feedback takes one message from the LED destination.
func (b *Bridge) Feedback(msg []byte) {
	b.step.Lock()
	defer b.step.Unlock()
	b.mu.Lock()
	mode := b.cfg.LEDMode
	changed := b.eng.Feedback(msg)
	b.mu.Unlock()
	b.activity("in", msg)
	if changed || mode == mapping.LEDFeedback {
		b.syncLamps()
	}
}

// Tick runs the engine's timers once. The tick loop calls it; tests call it directly.
func (b *Bridge) Tick() {
	b.step.Lock()
	defer b.step.Unlock()
	b.mu.Lock()
	msgs := b.eng.Tick(b.now())
	b.mu.Unlock()
	b.send(msgs)
	if len(msgs) > 0 {
		b.syncLamps()
	}
}

// startTicking runs Tick every tickEvery until the engine has nothing pending.
func (b *Bridge) startTicking() {
	b.mu.Lock()
	if b.ticking {
		b.mu.Unlock()
		return
	}
	b.ticking = true
	b.mu.Unlock()
	go func() {
		t := time.NewTicker(tickEvery)
		defer t.Stop()
		for {
			select {
			case <-b.stop:
				return
			case <-t.C:
			}
			b.Tick()
			b.mu.Lock()
			if !b.eng.Pending() {
				b.ticking = false
				b.mu.Unlock()
				return
			}
			b.mu.Unlock()
		}
	}()
}

func (b *Bridge) send(msgs [][]byte) {
	if len(msgs) == 0 {
		return
	}
	b.mu.Lock()
	out := b.out
	b.mu.Unlock()
	for _, m := range msgs {
		if out != nil {
			_ = out.Send(m)
		}
		b.activity("out", m)
	}
}

func (b *Bridge) activity(dir string, msg []byte) {
	if b.onActivity == nil {
		return
	}
	bs := make([]int, len(msg))
	for i, c := range msg {
		bs[i] = int(c)
	}
	b.onActivity(Activity{Dir: dir, Bytes: bs, Label: mapping.Describe(msg), At: b.now().UnixMilli()})
}

// syncLamps hands the engine's lamp state to the pedal when it changed. The pedal side
// diffs per lamp again, so this only saves the call.
func (b *Bridge) syncLamps() {
	b.mu.Lock()
	l := b.eng.Lamps()
	p := b.pedal
	if p == nil || (b.lit && l == b.lamps) {
		b.mu.Unlock()
		return
	}
	b.lamps, b.lit = l, true
	b.mu.Unlock()
	p.SetLamps(l)
}
