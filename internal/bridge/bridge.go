// Package bridge joins the pedal to the virtual MIDI port.
//
// Pedal events (switch edges, raw expression values, status) come in from the BLE
// manager on its goroutines. The bridge serialises them through one mapping.Engine,
// sends what the engine returns to the virtual MIDI source, and keeps the pedal's lamps
// in step with what the engine says they should show. MIDI arriving on the LED
// destination goes through the same engine, so feedback mode lights the lamps from the
// DAW's real state.
//
// The bridge decides all eight lamps: the six switch lamps from the engine, and the Amp
// and App lamps from the user's indicator modes (mapping.IndicatorLamps) and what the
// bridge knows: whether the pedal is held, whether USB powers it, and whether MIDI went
// out or came in during the last flashFor.
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
	SetLamps(l [sparkx.Lamps]sparkx.Colour)
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

// flashFor is how long an indicator in a MIDI mode stays lit after the last message. A
// message while it is lit only extends it, so a burst is two lamp updates: on and off.
const flashFor = 120 * time.Millisecond

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
	lamps [sparkx.Lamps]sparkx.Colour
	lit   bool // lamps were sent at least once since the last connect

	// What the indicator lamps follow.
	connected bool
	powered   bool
	outUntil  time.Time // a MIDI-out flash is lit until then
	inUntil   time.Time // a MIDI-in flash is lit until then

	trig [sparkx.ExpInputs]bool // the expression triggers engaged, as last reported

	sim     [sparkx.ExpInputs]simInput // the simulated expression pedals (sim.go)
	simLoop bool                       // the sim loop is running
	isDone  bool                       // Close was called

	now        func() time.Time
	onActivity func(Activity)
	onStatus   func(ble.Status)
	onTrigger  func([sparkx.ExpInputs]bool)
	onSim      func()

	ticking bool
	stop    chan struct{}
	closed  sync.Once
}

// Options are the bridge's callbacks. All may be nil. OnStatus is called with no lock
// held. OnActivity and OnTrigger are called in order while one step is going through,
// so they must not call back into the bridge.
type Options struct {
	OnActivity func(Activity)
	OnStatus   func(ble.Status)
	// OnTrigger is called when an expression trigger engages or lets go, with which
	// are engaged now (mapping.Engine.ExpTriggers).
	OnTrigger func([sparkx.ExpInputs]bool)
	// OnSim is called, with no lock held, when a simulated expression pedal turns on or
	// off or its value reaches the engine: what Status and ExpSim report changed.
	OnSim func()
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
		onTrigger:  o.OnTrigger,
		onSim:      o.OnSim,
		sim:        newSims(),
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

// Close stops the tick loop and the simulation loop. Simulation calls fail after it.
func (b *Bridge) Close() {
	b.closed.Do(func() {
		b.mu.Lock()
		b.isDone = true
		b.mu.Unlock()
		close(b.stop)
	})
}

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
	releases := b.eng.SetConfig(cfg)
	b.simRepushLocked() // a new calibration applies to a parked simulated pedal at once
	b.mu.Unlock()
	b.send(releases)
	b.syncLamps()
	b.syncTriggers()
	return cfg, nil
}

// ExpTriggers says which expression inputs' triggers are engaged now.
func (b *Bridge) ExpTriggers() [sparkx.ExpInputs]bool {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.eng.ExpTriggers()
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
	b.syncTriggers() // the engine's timers ran first: an off delay may have ended
	if pending {
		b.startTicking()
	}
}

func (b *Bridge) onExp(n, raw int) {
	b.step.Lock()
	defer b.step.Unlock()
	b.mu.Lock()
	if n >= 0 && n < sparkx.ExpInputs && b.sim[n].on {
		// The jack is simulated: a real value can only come from a cable the next status
		// will report, and that status hands the jack back (takeOverLocked).
		b.mu.Unlock()
		return
	}
	b.mu.Unlock()
	b.expStep(n, raw)
}

// expStep feeds one raw expression value to the engine and sends what comes out: real
// values and simulated ones go the same way. The caller holds step.
func (b *Bridge) expStep(n, raw int) {
	b.mu.Lock()
	msgs := b.eng.Exp(n, raw, b.now())
	pending := b.eng.Pending()
	b.mu.Unlock()
	if len(msgs) > 0 {
		b.send(msgs)
		b.syncLamps()
	}
	b.syncTriggers()
	if pending {
		b.startTicking() // an expression trigger's off delay
	}
}

func (b *Bridge) onPedalStatus(st ble.Status) {
	b.step.Lock()
	b.mu.Lock()
	b.connected = st.State == ble.StateConnected
	b.powered = b.connected && st.Powered
	b.mu.Unlock()
	simChanged := false
	if st.State != ble.StateConnected {
		b.mu.Lock()
		releases := b.eng.Reset()
		b.simRepushLocked() // a simulated pedal engages again from where it is
		b.lit = false
		b.mu.Unlock()
		b.send(releases)
	} else {
		// A jack without a cable lets go of its trigger: a pedal pulled out mid-sweep
		// must not leave the effect it engaged stuck on. A simulated jack has a cable as
		// far as the engine knows; a real cable in it ends the simulation.
		var releases [][]byte
		b.mu.Lock()
		for n, in := range st.Cables {
			switch {
			case in && b.sim[n].on:
				releases = append(releases, b.takeOverLocked(n)...)
				simChanged = true
			case !in && !b.sim[n].on:
				releases = append(releases, b.eng.ExpRelease(n)...)
			}
		}
		b.mu.Unlock()
		b.send(releases)
		// A fresh connection starts with lamps unknown (lit is false): syncLamps writes
		// them once even if they match what went to the previous link. After that it
		// only passes on changes: the USB power state, say.
		b.syncLamps()
	}
	b.syncTriggers()
	b.step.Unlock()
	if b.onStatus != nil {
		b.onStatus(st)
	}
	if simChanged {
		b.simChanged()
	}
}

// Feedback takes one message from the LED destination.
func (b *Bridge) Feedback(msg []byte) {
	b.step.Lock()
	defer b.step.Unlock()
	b.mu.Lock()
	b.eng.Feedback(msg)
	b.inUntil = b.now().Add(flashFor)
	b.mu.Unlock()
	b.activity("in", msg)
	b.syncLamps()
	b.startTicking()
}

// Tick runs the engine's timers once. The tick loop calls it; tests call it directly.
func (b *Bridge) Tick() {
	b.step.Lock()
	defer b.step.Unlock()
	b.mu.Lock()
	msgs := b.eng.Tick(b.now())
	b.mu.Unlock()
	b.send(msgs)
	// Also when nothing was sent: a flash may have run out. syncLamps only passes on
	// a change.
	b.syncLamps()
	b.syncTriggers()
}

// syncTriggers tells OnTrigger when an expression trigger engaged or let go.
func (b *Bridge) syncTriggers() {
	b.mu.Lock()
	t := b.eng.ExpTriggers()
	changed := t != b.trig
	b.trig = t
	b.mu.Unlock()
	if changed && b.onTrigger != nil {
		b.onTrigger(t)
	}
}

// pendingLocked says whether Tick has work: the engine's timers, or a flash to end.
func (b *Bridge) pendingLocked() bool {
	now := b.now()
	return b.eng.Pending() || now.Before(b.outUntil) || now.Before(b.inUntil)
}

// startTicking runs Tick every tickEvery until the engine has nothing pending and no
// flash is lit.
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
			if !b.pendingLocked() {
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
	b.outUntil = b.now().Add(flashFor)
	b.mu.Unlock()
	for _, m := range msgs {
		if out != nil {
			_ = out.Send(m)
		}
		b.activity("out", m)
	}
	b.startTicking()
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

// lampsLocked is what all eight lamps should show now.
func (b *Bridge) lampsLocked() [sparkx.Lamps]sparkx.Colour {
	var l [sparkx.Lamps]sparkx.Colour
	sw := b.eng.Lamps()
	copy(l[:], sw[:])
	now := b.now()
	ind := mapping.IndicatorLamps(b.cfg, mapping.IndicatorState{
		Connected: b.connected,
		Powered:   b.powered,
		Out:       now.Before(b.outUntil),
		In:        now.Before(b.inUntil),
	})
	l[sparkx.LampAmp], l[sparkx.LampApp] = ind[mapping.IndicatorAmp], ind[mapping.IndicatorApp]
	return l
}

// syncLamps hands the lamp state to the pedal when it changed. The pedal side diffs
// per lamp again, so this only saves the call.
func (b *Bridge) syncLamps() {
	b.mu.Lock()
	l := b.lampsLocked()
	p := b.pedal
	if p == nil || (b.lit && l == b.lamps) {
		b.mu.Unlock()
		return
	}
	b.lamps, b.lit = l, true
	b.mu.Unlock()
	p.SetLamps(l)
}
