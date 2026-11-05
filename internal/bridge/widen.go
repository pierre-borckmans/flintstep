package bridge

import (
	"time"

	"flintstep/internal/sparkx"
)

// LEARNING THE RANGE. A sweep that stopped a little short leaves the ends of the travel
// clamped. While the pedal is played, a value past the calibrated heel or toe by more
// than the sweep's margin is noted; once widenSamples of them have come within
// widenWindow, the bridge proposes a wider range (Options.OnWiden). It never narrows
// and never saves: the UI applies the proposal as an edit, if the user has learning on,
// so its history and autosave stay the only writers of the mapping.

// widenSamples past an end, each within widenWindow of the last, make a proposal.
const (
	// One reading past an end is enough: a pedal at rest sends nothing, so parking at a
	// new heel gives a single sample (see sweepExtremes).
	widenSamples = 1
	widenWindow  = 3 * time.Second
)

// widenSide is what has been seen past one end.
type widenSide struct {
	count int
	far   int // the furthest value past the end
	next  int // the second furthest: the proposal, so a lone spike cannot set it
	at    time.Time
}

// widenState is one input's learning: the range proposed so far (-1: none since the
// last Apply) and what each end has seen.
type widenState struct {
	lo, hi    int
	low, high widenSide
}

func newWidens() [sparkx.ExpInputs]widenState {
	var w [sparkx.ExpInputs]widenState
	for n := range w {
		w[n] = widenState{lo: -1, hi: -1}
	}
	return w
}

// widenLocked notes raw on input n and says whether it makes a wider range lo..hi to
// propose. Nothing while a sweep runs on the input or it has no calibrated travel.
func (b *Bridge) widenLocked(n, raw int) (lo, hi int, ok bool) {
	if n < 0 || n >= sparkx.ExpInputs || raw < 0 || b.capt[n].on {
		return 0, 0, false
	}
	x := b.cfg.Exp[n]
	if x.Min == x.Max {
		return 0, 0, false
	}
	w := &b.wid[n]
	lo, hi = min(x.Min, x.Max), max(x.Min, x.Max)
	if w.lo >= 0 {
		lo = min(lo, w.lo)
	}
	if w.hi >= 0 {
		hi = max(hi, w.hi)
	}
	m := sweepMargin(hi - lo)
	now := b.now()
	switch {
	case raw < lo-m:
		if note(&w.low, raw, now, -1) {
			if v := w.low.next + m; v < lo {
				lo, w.lo, ok = v, v, true
			}
			w.low = widenSide{}
		}
	case raw > hi+m:
		if note(&w.high, raw, now, 1) {
			if v := w.high.next - m; v > hi {
				hi, w.hi, ok = v, v, true
			}
			w.high = widenSide{}
		}
	}
	return lo, hi, ok
}

// note adds raw to one side (way -1 for below the heel-or-toe low end, 1 for above the
// high one) and says whether that side now has widenSamples.
func note(s *widenSide, raw int, now time.Time, way int) bool {
	if s.count > 0 && now.Sub(s.at) > widenWindow {
		*s = widenSide{}
	}
	switch {
	case s.count == 0:
		s.far, s.next = raw, raw
	case way*(raw-s.far) > 0:
		s.far, s.next = raw, s.far
	case way*(raw-s.next) > 0 || s.count == 1:
		s.next = raw
	}
	s.count++
	s.at = now
	return s.count >= widenSamples
}
