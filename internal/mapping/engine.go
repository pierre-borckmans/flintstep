package mapping

import (
	"sort"
	"time"

	"flintstep/internal/sparkx"
)

// THE ENGINE: switch edges and expression values in, MIDI out.
//
// Pure, like sparkx: edges, raw values and a clock in, messages out. The bridge feeds
// it from the BLE handlers and calls Tick while Pending says a timer is running.
//
// Two things make a press wait before it means anything:
//   - a Long action: a tap only shows itself on release, a long press when the switch
//     has been held LongPressMS;
//   - a Combo: the switch waits comboWindow for its partner. Feet are not exact, and
//     60 ms is long enough to catch two switches stamped together and short enough
//     that a lone press does not feel late.
// A switch in both waits for its partner first, then for the long press, both timed
// from the moment it went down.
//
// Whatever a press sent, its release sends the other half of that same action, even
// if the config changed in between: a note held across a SetConfig still gets its
// note off.

// comboWindow is how long a switch that is part of a combo waits for its partner.
const comboWindow = 60 * time.Millisecond

type phase int

const (
	idle      phase = iota
	waitCombo       // down, waiting for a combo partner until due
	waitLong        // down, waiting to become a long press at due
	tapDown         // Tap's press half sent
	longDown        // Long's press half sent
	comboDown       // a combo's press half sent; the first of the two to go up ends it
	spent           // its combo already ended; the release does nothing
)

type press struct {
	held    bool
	down    time.Time
	phase   phase
	due     time.Time
	active  Action // what the press sent, so the release ends the same thing
	src     Origin // where active came from, for the activity log
	partner int    // comboDown: the other switch
}

// fbKey names a controller or note on a channel, for LED feedback.
type fbKey struct {
	kind ActionKind
	ch   int
	num  int
}

// Engine turns one pedal's input into MIDI. Not safe for concurrent use; the bridge
// serialises calls.
type Engine struct {
	cfg     Config
	sw      [sparkx.Switches]press
	tapOn   [sparkx.Switches]bool // Tap toggles that are on
	longOn  [sparkx.Switches]bool // Long toggles that are on
	comboOn map[[2]int]bool       // combo toggles that are on, by pairKey
	fb      map[fbKey]bool        // feedback received: lit or not
	exp     *sparkx.ExpScale
	trig    [sparkx.ExpInputs]trigger // expression triggers (trigger.go)
}

// NewEngine starts with nothing held and every toggle off.
func NewEngine(cfg Config) *Engine {
	return &Engine{
		cfg:     cfg.Normalize(),
		comboOn: map[[2]int]bool{},
		fb:      map[fbKey]bool{},
		exp:     sparkx.NewExpScale(),
	}
}

// SetConfig switches to cfg. A toggle keeps its state if its action is still a CC
// toggle, so editing a colour does not turn effects off behind the user's back.
// An expression input whose settings changed sends its next value whatever it is.
//
// It returns the release half of an expression trigger that has to let go: its input
// was switched off, or its mode or action changed. A new threshold is only read on the
// next value.
func (e *Engine) SetConfig(cfg Config) Outs {
	cfg = cfg.Normalize()
	var out Outs
	for n := range e.trig {
		if trigKey(e.cfg.Exp[n]) != trigKey(cfg.Exp[n]) {
			out = append(out, e.letGo(n)...)
			tr := cfg.Exp[n].Trigger
			e.trig[n].on = e.trig[n].on && isToggle(tr.Action) && tr.Action == e.cfg.Exp[n].Trigger.Action
		}
	}
	for n := range e.tapOn {
		e.tapOn[n] = e.tapOn[n] && isToggle(cfg.Switches[n].Tap)
		e.longOn[n] = e.longOn[n] && isToggle(cfg.Switches[n].Long)
	}
	kept := map[[2]int]bool{}
	for _, cb := range cfg.Combos {
		k := pairKey(cb.A, cb.B)
		if e.comboOn[k] && isToggle(cb.Action) {
			kept[k] = true
		}
	}
	e.comboOn = kept
	for n := range e.cfg.Exp {
		if !e.cfg.Exp[n].sameAs(cfg.Exp[n]) {
			e.exp.Reset(n)
		}
	}
	e.cfg = cfg
	return out
}

// Switch takes one edge and returns the MIDI to send now. Timers due by at fire
// first, so a late Tick never reorders what the pedal did.
func (e *Engine) Switch(ed sparkx.Edge, at time.Time) Outs {
	if !validSwitch(ed.Switch) {
		return nil
	}
	out := e.Tick(at)
	n := ed.Switch
	s := &e.sw[n]
	if ed.Down == s.held {
		return out // a repeat of what we already know
	}
	if ed.Down {
		return append(out, e.down(n, at)...)
	}
	return append(out, e.up(n)...)
}

func (e *Engine) down(n int, at time.Time) Outs {
	s := &e.sw[n]
	*s = press{held: true, down: at}
	if p, a, ci, ok := e.partner(n, at); ok {
		src := Origin{Source: SrcCombo, Index: ci, Pair: [2]int{e.cfg.Combos[ci].A, e.cfg.Combos[ci].B}}
		e.sw[p].phase, e.sw[p].active, e.sw[p].src, e.sw[p].partner = comboDown, a, src, n
		s.phase, s.active, s.src, s.partner = comboDown, a, src, p
		k := pairKey(n, p)
		on := e.comboOn[k]
		out := e.pressHalf(a, &on)
		e.comboOn[k] = on
		return tag(out, src)
	}
	if e.inCombo(n) {
		s.phase, s.due = waitCombo, at.Add(comboWindow)
		return nil
	}
	return e.begin(n)
}

// partner finds a switch waiting for n to make a combo: the one that went down first.
// It returns the switch, the combo's action and the combo's index in the config.
func (e *Engine) partner(n int, at time.Time) (int, Action, int, bool) {
	best, bestA, bestI, found := -1, Action{}, -1, false
	for p := range e.sw {
		ps := e.sw[p]
		if p == n || ps.phase != waitCombo || !at.Before(ps.due) {
			continue
		}
		a, ci, ok := e.combo(n, p)
		if !ok {
			continue
		}
		if !found || ps.down.Before(e.sw[best].down) {
			best, bestA, bestI, found = p, a, ci, true
		}
	}
	return best, bestA, bestI, found
}

// begin starts n's own action, once no combo can claim it: a switch with a Long
// action waits, one without fires its Tap now.
func (e *Engine) begin(n int) Outs {
	s := &e.sw[n]
	sc := e.cfg.Switches[n]
	if sc.Long.Kind != KindOff {
		s.phase, s.due = waitLong, s.down.Add(time.Duration(e.cfg.LongPressMS)*time.Millisecond)
		return nil
	}
	s.phase, s.active, s.src = tapDown, sc.Tap, Origin{Source: SrcSwitch, Index: n}
	return tag(e.pressHalf(sc.Tap, &e.tapOn[n]), s.src)
}

func (e *Engine) up(n int) Outs {
	s := &e.sw[n]
	ph, a, src, p := s.phase, s.active, s.src, s.partner
	*s = press{}
	switch ph {
	case waitCombo, waitLong:
		// Released before anything was decided: a tap, sent whole.
		tap := e.cfg.Switches[n].Tap
		return tag(append(e.pressHalf(tap, &e.tapOn[n]), e.releaseHalf(tap)...), Origin{Source: SrcSwitch, Index: n})
	case tapDown, longDown:
		return tag(e.releaseHalf(a), src)
	case comboDown:
		if e.sw[p].held {
			e.sw[p].phase = spent
		}
		return tag(e.releaseHalf(a), src)
	}
	return nil
}

// Tick fires the timers due by at: combo windows that closed without a partner, and
// long presses, and expression triggers' off delays. Called every ~10 ms while Pending.
func (e *Engine) Tick(at time.Time) Outs {
	var out Outs
	for {
		n := e.nextDue(at)
		if n < 0 {
			return append(out, e.tickTriggers(at)...)
		}
		s := &e.sw[n]
		switch s.phase {
		case waitCombo:
			out = append(out, e.begin(n)...)
		case waitLong:
			l := e.cfg.Switches[n].Long
			s.phase, s.active, s.src = longDown, l, Origin{Source: SrcLong, Index: n}
			out = append(out, tag(e.pressHalf(l, &e.longOn[n]), s.src)...)
		}
	}
}

// nextDue is the switch whose timer ran out first by at, or -1.
func (e *Engine) nextDue(at time.Time) int {
	var due []int
	for n, s := range e.sw {
		if (s.phase == waitCombo || s.phase == waitLong) && !at.Before(s.due) {
			due = append(due, n)
		}
	}
	if len(due) == 0 {
		return -1
	}
	sort.SliceStable(due, func(i, j int) bool { return e.sw[due[i]].due.Before(e.sw[due[j]].due) })
	return due[0]
}

// Pending reports whether a timer is running, so Tick has work.
func (e *Engine) Pending() bool {
	for _, s := range e.sw {
		if s.phase == waitCombo || s.phase == waitLong {
			return true
		}
	}
	return e.triggerPending()
}

// Reset forgets every press: the pedal is gone, and so are its switches. Toggles
// stay as they are, since the DAW still has them on. The expression inputs send
// their next value whatever it is, and their triggers let go.
//
// It returns the release half of everything still sounding, so a pedal that drops
// mid-press does not leave a note hanging or a momentary CC stuck on in the DAW.
func (e *Engine) Reset() Outs {
	var out Outs
	ended := map[[2]int]bool{}
	for n, p := range e.sw {
		switch p.phase {
		case tapDown, longDown:
			out = append(out, released(tag(e.releaseHalf(p.active), p.src))...)
		case comboDown:
			if k := pairKey(n, p.partner); !ended[k] {
				ended[k] = true
				out = append(out, released(tag(e.releaseHalf(p.active), p.src))...)
			}
		}
	}
	e.sw = [sparkx.Switches]press{}
	for n := range e.cfg.Exp {
		out = append(out, e.ExpRelease(n)...)
	}
	return out
}

// combo is the action for switches a and b pressed together, and its index in the
// config, if there is one. The first matching combo wins; one that does nothing is no
// combo.
func (e *Engine) combo(a, b int) (Action, int, bool) {
	k := pairKey(a, b)
	for i, cb := range e.cfg.Combos {
		if cb.A != cb.B && pairKey(cb.A, cb.B) == k && cb.Action.Kind != KindOff {
			return cb.Action, i, true
		}
	}
	return Action{}, -1, false
}

func (e *Engine) inCombo(n int) bool {
	for p := range e.sw {
		if _, _, ok := e.combo(n, p); ok && p != n {
			return true
		}
	}
	return false
}

// pressHalf is what a press of a sends. on is a's toggle state, flipped by a CC toggle.
func (e *Engine) pressHalf(a Action, on *bool) [][]byte {
	switch a.Kind {
	case KindCC:
		if a.Mode == Toggle {
			*on = !*on
			if !*on {
				return [][]byte{ccMsg(a.Channel, a.Number, 0)}
			}
		}
		return [][]byte{ccMsg(a.Channel, a.Number, a.Value)}
	case KindNote:
		return [][]byte{noteOn(a.Channel, a.Number, a.Value)}
	case KindPC:
		return [][]byte{pcMsg(a.Channel, a.Number)}
	}
	return nil
}

// releaseHalf is what a release of a sends: only momentary CCs and notes have one.
func (e *Engine) releaseHalf(a Action) [][]byte {
	switch {
	case a.Kind == KindCC && a.Mode != Toggle:
		return [][]byte{ccMsg(a.Channel, a.Number, 0)}
	case a.Kind == KindNote:
		return [][]byte{noteOff(a.Channel, a.Number)}
	}
	return nil
}

func isToggle(a Action) bool { return a.Kind == KindCC && a.Mode == Toggle }

// Exp turns input n's raw value into its CC. Min is the heel and Max the toe, in
// whatever order the numbers fall: heel sends 0 and toe 127 either way, and Invert
// (the user's own choice) flips that on top. The calibrated travel is stretched to
// the full raw range first, so ExpScale's hysteresis (half a step and a margin) is
// measured in steps of the pedal the user actually has. The response curve (curve.go)
// bends the travel next, before the hysteresis, so a resting pedal does not flicker on
// a steep part of the curve. Nothing comes back for the CC when the input is off or the
// value did not move a step.
//
// The same curved travel drives the input's trigger (trigger.go): a press half goes before
// the CC, a release half after it. Timers due by at fire first, as in Switch.
func (e *Engine) Exp(n, raw int, at time.Time) Outs {
	out := e.Tick(at)
	if n < 0 || n >= sparkx.ExpInputs || !e.cfg.Exp[n].Enabled {
		return out
	}
	x := e.cfg.Exp[n]
	heel, toe := x.Min, x.Max
	if heel == toe {
		// Calibrated at one point: no travel to stretch, use the jack's whole range.
		heel, toe = 0, ExpRawMax
	}
	lo, hi := min(heel, toe), max(heel, toe)
	r := min(max(raw, lo), hi)
	travel := r - heel // how far from the heel, towards the toe
	if toe < heel {
		travel = heel - r
	}
	scaled := int((int64(travel)*ExpRawMax + int64(hi-lo)/2) / int64(hi-lo))
	if x.Invert {
		scaled = ExpRawMax - scaled
	}
	scaled = x.Curve.curveScaled(scaled)
	press, release := e.trigger(n, scaled, at)
	out = append(out, press...)
	if v, changed := e.exp.Feed(n, scaled); changed {
		out = append(out, Out{Msg: ccMsg(x.Channel, x.CC, v), Src: Origin{Source: SrcExp, Index: n}})
	}
	return append(out, release...)
}

// Feedback takes a message from the LED destination. A CC or note records whether
// that controller or note is on (non-zero); true if the lamps changed as a result.
// It is recorded in local mode too, so switching to feedback mode shows the DAW's
// state at once.
func (e *Engine) Feedback(msg []byte) bool {
	if len(msg) < 3 {
		return false
	}
	ch, num, v := int(msg[0]&0x0F)+1, int(msg[1]), msg[2]
	var k fbKey
	var on bool
	switch msg[0] & 0xF0 {
	case stCC:
		k, on = fbKey{KindCC, ch, num}, v > 0
	case stNoteOn:
		k, on = fbKey{KindNote, ch, num}, v > 0
	case stNoteOff:
		k, on = fbKey{KindNote, ch, num}, false
	default:
		return false
	}
	before := e.Lamps()
	e.fb[k] = on
	return e.Lamps() != before
}

// Lamps is what the six switch lamps should show now, dimmed by Brightness.
func (e *Engine) Lamps() [sparkx.Switches]sparkx.Colour {
	var out [sparkx.Switches]sparkx.Colour
	for n := range out {
		if e.lit(n) {
			out[n] = dim(e.cfg.Switches[n].Colour, e.cfg.Brightness)
		}
	}
	return out
}

func (e *Engine) lit(n int) bool {
	if e.cfg.LEDMode == LEDFeedback {
		t := e.cfg.Switches[n].Tap
		if t.Kind != KindCC && t.Kind != KindNote {
			return false // a program change has no on or off to show
		}
		return e.fb[fbKey{t.Kind, t.Channel, t.Number}]
	}
	if e.sw[n].held || e.tapOn[n] || e.longOn[n] {
		return true
	}
	for k, on := range e.comboOn {
		if on && (k[0] == n || k[1] == n) {
			return true
		}
	}
	return false
}

// dim scales c to pct percent, rounding, so 100 is c and 0 is off.
func dim(c sparkx.Colour, pct int) sparkx.Colour {
	f := func(v uint8) uint8 { return uint8((int(v)*pct + 50) / 100) }
	return sparkx.Colour{R: f(c.R), G: f(c.G), B: f(c.B)}
}
