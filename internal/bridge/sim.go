package bridge

import (
	"errors"
	"fmt"
	"log"
	"math"
	"time"

	"flintstep/internal/ble"
	"flintstep/internal/mapping"
	"flintstep/internal/sparkx"
)

// A simulated expression pedal stands in for a real one on a jack with no cable, so
// the whole path (calibration, invert, CC, trigger, virtual port, activity log) can be
// tried without the hardware. Its raw value goes to the engine the way a real pedal's
// does (expStep), and Status reports the jack as having a cable and the simulated raw.
// A real cable in the jack ends the simulation. Nothing about it is saved.

// simEvery is the most often a simulated value reaches the engine (~60 Hz, the rate
// the pedal itself streams at). A slider fires faster; the loop sends the latest.
const simEvery = 16 * time.Millisecond

// SweepPeriod is one heel → toe → heel sweep.
const SweepPeriod = 4 * time.Second

// ErrClosed is returned by the simulation calls once the bridge is closed.
var ErrClosed = errors.New("bridge: closed")

type simInput struct {
	on    bool
	sweep bool
	frac  float64   // the position, 0 heel .. 1 toe, when not sweeping
	from  time.Time // sweeping: when the sweep was at the heel, going up
	raw   int       // the value as last computed
	sent  int       // the last value fed to the engine, -1 = feed the next one
	at    time.Time // when it was fed
}

func newSims() [sparkx.ExpInputs]simInput {
	var s [sparkx.ExpInputs]simInput
	for n := range s {
		s[n].sent, s[n].raw = -1, -1
	}
	return s
}

// FractionRaw is a 0..1 position as a raw jack value, 0..65535, linearly. The user's
// heel/toe calibration then applies to it as to a real pedal's reading.
func FractionRaw(f float64) int {
	f = min(max(f, 0), 1)
	return int(math.Round(f * mapping.ExpRawMax))
}

// sweepFraction is where a sweep started at the heel is after d: an eased (cosine)
// heel → toe → heel every SweepPeriod.
func sweepFraction(d time.Duration) float64 {
	ph := float64(d%SweepPeriod) / float64(SweepPeriod)
	return (1 - math.Cos(2*math.Pi*ph)) / 2
}

// sweepOffset is how far into a sweep it is at fraction f on the way up, so a sweep
// starts from where the pedal is rather than jumping to the heel.
func sweepOffset(f float64) time.Duration {
	f = min(max(f, 0), 1)
	return time.Duration(math.Acos(1-2*f) / (2 * math.Pi) * float64(SweepPeriod))
}

// rawAt is the simulated value at now.
func (s *simInput) rawAt(now time.Time) int {
	if s.sweep {
		return FractionRaw(sweepFraction(now.Sub(s.from)))
	}
	return FractionRaw(s.frac)
}

func checkInput(n int) error {
	if n < 0 || n >= sparkx.ExpInputs {
		return fmt.Errorf("no expression input %d", n+1)
	}
	return nil
}

// realCableLocked says whether the pedal reports a real cable in jack n.
func (b *Bridge) realCableLocked(n int) bool {
	if b.pedal == nil {
		return false
	}
	st := b.pedal.Status()
	return st.State == ble.StateConnected && st.Cables[n]
}

// SimulateExp turns input n's simulated pedal on or off. On, it starts at the heel;
// it is refused while a real cable is in the jack. Off lets go of anything the input's
// trigger holds, as a cable coming out does, and forgets its reading.
func (b *Bridge) SimulateExp(n int, on bool) error {
	if err := checkInput(n); err != nil {
		return err
	}
	b.step.Lock()
	b.mu.Lock()
	if b.isDone {
		b.mu.Unlock()
		b.step.Unlock()
		return ErrClosed
	}
	if on == b.sim[n].on {
		b.mu.Unlock()
		b.step.Unlock()
		return nil
	}
	if !on {
		releases := b.simOffLocked(n)
		b.mu.Unlock()
		b.send(releases)
		b.syncLamps()
		b.syncTriggers()
		b.step.Unlock()
		b.simChanged()
		return nil
	}
	if b.realCableLocked(n) {
		b.mu.Unlock()
		b.step.Unlock()
		return fmt.Errorf("a real pedal is plugged into jack %d", n+1)
	}
	b.sim[n] = simInput{on: true, sent: -1, raw: -1}
	b.mu.Unlock()
	b.simFeed(n)
	b.step.Unlock()
	b.startSimLoop()
	b.simChanged()
	return nil
}

// SetSimExp moves input n's simulated pedal to fraction f of its travel (0 heel,
// 1 toe; clamped), as the raw value FractionRaw(f). It turns the simulation on if it
// was off and stops a sweep: grabbing the pedal stops it moving.
func (b *Bridge) SetSimExp(n int, f float64) error {
	if err := checkInput(n); err != nil {
		return err
	}
	if math.IsNaN(f) {
		return errors.New("the pedal position is not a number")
	}
	if err := b.ensureSim(n); err != nil {
		return err
	}
	b.step.Lock()
	b.mu.Lock()
	if !b.sim[n].on { // switched off in between
		b.mu.Unlock()
		b.step.Unlock()
		return nil
	}
	b.sim[n].sweep = false
	b.sim[n].frac = min(max(f, 0), 1)
	b.mu.Unlock()
	fed := b.simFeed(n)
	b.step.Unlock()
	if fed {
		b.simChanged()
	}
	return nil
}

// SimSweep makes input n's simulated pedal sweep heel → toe → heel on its own, eased,
// every SweepPeriod, starting from where it is. On turns the simulation on if it was
// off. Off leaves the pedal where the sweep had got to.
func (b *Bridge) SimSweep(n int, on bool) error {
	if err := checkInput(n); err != nil {
		return err
	}
	if on {
		if err := b.ensureSim(n); err != nil {
			return err
		}
	}
	b.step.Lock()
	b.mu.Lock()
	s := &b.sim[n]
	if b.isDone {
		b.mu.Unlock()
		b.step.Unlock()
		return ErrClosed
	}
	if !s.on || s.sweep == on {
		b.mu.Unlock()
		b.step.Unlock()
		return nil
	}
	now := b.now()
	if on {
		s.from = now.Add(-sweepOffset(s.frac))
		s.sweep = true
	} else {
		s.frac = sweepFraction(now.Sub(s.from))
		s.sweep = false
	}
	b.mu.Unlock()
	b.simFeed(n)
	b.step.Unlock()
	b.simChanged()
	return nil
}

// ensureSim turns input n's simulation on if it is off.
func (b *Bridge) ensureSim(n int) error {
	b.mu.Lock()
	on, done := b.sim[n].on, b.isDone
	b.mu.Unlock()
	if done {
		return ErrClosed
	}
	if on {
		return nil
	}
	return b.SimulateExp(n, true)
}

// ExpSim says which expression inputs are simulated now.
func (b *Bridge) ExpSim() [sparkx.ExpInputs]bool {
	b.mu.Lock()
	defer b.mu.Unlock()
	var out [sparkx.ExpInputs]bool
	for n := range b.sim {
		out[n] = b.sim[n].on
	}
	return out
}

// ExpSweep says which simulated inputs are sweeping on their own now.
func (b *Bridge) ExpSweep() [sparkx.ExpInputs]bool {
	b.mu.Lock()
	defer b.mu.Unlock()
	var out [sparkx.ExpInputs]bool
	for n := range b.sim {
		out[n] = b.sim[n].on && b.sim[n].sweep
	}
	return out
}

// Status is the pedal's status with the simulated inputs filled in: a cable in the
// jack and the simulated raw value. The UI reads this rather than the pedal's own.
func (b *Bridge) Status() ble.Status {
	b.mu.Lock()
	p := b.pedal
	sims := b.sim
	b.mu.Unlock()
	var st ble.Status
	if p != nil {
		st = p.Status()
	} else {
		st.ExpRaw = [sparkx.ExpInputs]int{-1, -1}
	}
	for n, s := range sims {
		if s.on {
			st.Cables[n] = true
			st.ExpRaw[n] = max(s.raw, 0)
		}
	}
	return st
}

// simFeed sends input n's simulated value to the engine if it changed and the last
// one went at least simEvery ago; the loop sends it later otherwise. The caller holds
// step. It says whether a value went.
func (b *Bridge) simFeed(n int) bool {
	b.mu.Lock()
	s := &b.sim[n]
	if !s.on {
		b.mu.Unlock()
		return false
	}
	now := b.now()
	s.raw = s.rawAt(now)
	if s.raw == s.sent || (s.sent >= 0 && now.Sub(s.at) < simEvery) {
		b.mu.Unlock()
		return false
	}
	s.sent, s.at = s.raw, now
	raw := s.raw
	b.mu.Unlock()
	b.expStep(n, raw)
	return true
}

// simStep feeds every simulated input's value that is due. The loop calls it every
// simEvery; tests call it directly.
func (b *Bridge) simStep() {
	b.step.Lock()
	fed := false
	for n := range sparkx.ExpInputs {
		if b.simFeed(n) {
			fed = true
		}
	}
	b.step.Unlock()
	if fed {
		b.simChanged()
	}
}

// startSimLoop runs simStep every simEvery while any input is simulated, until Close.
func (b *Bridge) startSimLoop() {
	b.mu.Lock()
	if b.simLoop || b.isDone {
		b.mu.Unlock()
		return
	}
	b.simLoop = true
	b.mu.Unlock()
	go func() {
		t := time.NewTicker(simEvery)
		defer t.Stop()
		for {
			select {
			case <-b.stop:
				b.mu.Lock()
				b.simLoop = false
				b.mu.Unlock()
				return
			case <-t.C:
			}
			b.simStep()
			b.mu.Lock()
			if !b.anySimLocked() {
				b.simLoop = false
				b.mu.Unlock()
				return
			}
			b.mu.Unlock()
		}
	}()
}

func (b *Bridge) anySimLocked() bool {
	for _, s := range b.sim {
		if s.on {
			return true
		}
	}
	return false
}

// simOffLocked ends input n's simulation: its trigger lets go and its reading is
// forgotten, as when a cable comes out. It returns the release to send.
func (b *Bridge) simOffLocked(n int) mapping.Outs {
	b.sim[n] = simInput{sent: -1, raw: -1}
	return b.eng.ExpRelease(n)
}

// takeOverLocked hands jack n to the real cable just plugged into it.
func (b *Bridge) takeOverLocked(n int) mapping.Outs {
	log.Printf("expression %d: a real pedal is plugged in, simulation off", n+1)
	return b.simOffLocked(n)
}

// simRepushLocked makes the loop feed every simulated value again: after the engine
// forgot it (Reset) or the calibration changed (Apply).
func (b *Bridge) simRepushLocked() {
	for n := range b.sim {
		b.sim[n].sent = -1
	}
}

func (b *Bridge) simChanged() {
	if b.onSim != nil {
		b.onSim()
	}
}
