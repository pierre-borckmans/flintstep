package bridge

import (
	"errors"
	"fmt"
	"slices"
	"time"

	"flintstep/internal/mapping"
	"flintstep/internal/sparkx"
)

// CALIBRATION BY SWEEPING. One click, then the user rocks the pedal back and forth,
// as sloppily as they like, and the bridge keeps every raw value that input reports.
// The capture sits in expStep, which every raw value goes through (real and simulated),
// so nothing is lost to the UI's state stream, which is throttled to 20 Hz and keeps
// only the latest value.
//
// The extremes are the plain ones (sweepExtremes): see there for why there is no filter
// does not count. The UI decides when it is over (lib/sweep.ts: at rest once Ready, or
// SweepTimeout) and calls FinishExpSweep; SweepCalibration then insets heel and toe.

// MinSweepSpan is the smallest robust span a sweep must cover to calibrate. The
// M-Audio EX-P spans about 27 000; a sixth of its travel is still above this.
const MinSweepSpan = 4000

// SweepMarginPercent of the span is kept inside each extreme, so the heel and toe
// stops reliably reach 0 and 127 even when they read a little short another time.
// Learning the range (widen.go) uses the same margin.
const SweepMarginPercent = 1

// wideSweepPercent of the jack's range counts as ready without a reversal.
const wideSweepPercent = 70

// SweepRest is how long a Ready sweep must sit still before it ends on its own, and
// SweepTimeout the longest one runs. The UI keeps time (lib/sweep.ts mirrors these).
const (
	SweepRest    = 1200 * time.Millisecond
	SweepTimeout = 15 * time.Second
)

// maxSweepSamples caps what one sweep keeps: 15 s at the pedal's ~60 Hz is 900.
const maxSweepSamples = 4096

// ErrSweepTooSmall is FinishExpSweep's answer when the pedal hardly moved.
var ErrSweepTooSmall = errors.New("the pedal barely moved: rock it all the way back and forth")

// Capture is one input's sweep, as the UI shows it.
type Capture struct {
	On bool `json:"on"`
	// Low and High are the lowest and highest values seen, -1 before any value.
	Low  int `json:"low"`
	High int `json:"high"`
	// RawLow and RawHigh are the plain lowest and highest values, -1 before any.
	RawLow  int `json:"rawLow"`
	RawHigh int `json:"rawHigh"`
	// Samples counts the values kept, the starting position included.
	Samples int `json:"samples"`
	// Reversals counts changes of direction once the span is MinSweepSpan wide.
	Reversals int `json:"reversals"`
	// Ready: the robust span is at least MinSweepSpan and the pedal turned back at least
	// once (or covered wideSweepPercent of the jack). At rest now, it can end.
	Ready bool `json:"ready"`
	// StartedAt, MovedAt (the last real movement) and ExtremeAt (when RawLow or RawHigh
	// last moved), unix ms.
	StartedAt int64 `json:"startedAt"`
	MovedAt   int64 `json:"movedAt"`
	ExtremeAt int64 `json:"extremeAt"`
}

type capture struct {
	on        bool
	samples   []int
	rawLow    int
	rawHigh   int
	reversals int
	dir       int // the way it is going: 0 not known, 1 up, -1 down
	peak      int // the furthest value of the current run
	anchor    int // where it last moved from, for "at rest"
	startedAt time.Time
	movedAt   time.Time
	extremeAt time.Time
}

func newCaptures() [sparkx.ExpInputs]capture {
	var c [sparkx.ExpInputs]capture
	for n := range c {
		c[n] = capture{rawLow: -1, rawHigh: -1}
	}
	return c
}

// SweepResult is what a finished sweep calibrates: Low and High as kept, Heel and Toe
// with the margin taken off.
type SweepResult struct {
	Low  int `json:"low"`
	High int `json:"high"`
	Heel int `json:"heel"`
	Toe  int `json:"toe"`
}

// SweepCalibration turns a swept low..high into heel and toe: heel at the low end and
// toe at the high one, SweepMarginPercent of the span inside each. A pedal whose toe
// reads lower gets heel = low too: which way it goes is the user's Invert.
func SweepCalibration(low, high int) (SweepResult, error) {
	if low < 0 || high < low || high-low < MinSweepSpan {
		return SweepResult{}, ErrSweepTooSmall
	}
	m := sweepMargin(high - low)
	return SweepResult{Low: low, High: high, Heel: low + m, Toe: high - m}, nil
}

func sweepMargin(span int) int { return (span*SweepMarginPercent + 50) / 100 }

// sweepExtremes are the plain lowest and highest values seen. There used to be a glitch
// filter here (an extreme had to have a second sample near it), and it was wrong for real
// pedals: an M-Audio EX-P sends nothing while it rests and changes fastest near the heel,
// so the true heel is often ONE sample, far from the last one before it, and the filter
// threw it away, leaving a sweep that "only saw a tiny range". No glitch has ever shown
// up in the recordings; the plain extremes are the truth.
func sweepExtremes(samples []int) (lo, hi int) {
	if len(samples) == 0 {
		return -1, -1
	}
	return slices.Min(samples), slices.Max(samples)
}

// StartExpSweep starts recording input n's values, from where the pedal is now. It
// needs a cable in the jack, a simulated one counts. Starting again starts over.
func (b *Bridge) StartExpSweep(n int) error {
	if err := checkInput(n); err != nil {
		return err
	}
	st := b.Status()
	if !st.Cables[n] {
		return fmt.Errorf("plug an expression pedal into jack %d first", n+1)
	}
	b.mu.Lock()
	defer b.mu.Unlock()
	if b.isDone {
		return ErrClosed
	}
	now := b.now()
	b.capt[n] = capture{on: true, rawLow: -1, rawHigh: -1, startedAt: now, movedAt: now, extremeAt: now}
	// The pedal only reports while it moves: where it rests is a position it reached.
	if raw := st.ExpRaw[n]; raw >= 0 {
		b.recordLocked(n, raw)
	}
	return nil
}

// CancelExpSweep stops input n's sweep without calibrating anything.
func (b *Bridge) CancelExpSweep(n int) error {
	if err := checkInput(n); err != nil {
		return err
	}
	b.mu.Lock()
	b.capt[n] = capture{rawLow: -1, rawHigh: -1}
	b.mu.Unlock()
	return nil
}

// FinishExpSweep stops input n's sweep and says what it calibrates. A sweep that
// covered too little (ErrSweepTooSmall) keeps going, so the user can rock it further
// and try again. Nothing is saved here: the caller applies the result.
func (b *Bridge) FinishExpSweep(n int) (SweepResult, error) {
	if err := checkInput(n); err != nil {
		return SweepResult{}, err
	}
	b.mu.Lock()
	defer b.mu.Unlock()
	c := b.capt[n]
	if !c.on {
		return SweepResult{}, fmt.Errorf("expression %d is not being swept", n+1)
	}
	lo, hi := sweepExtremes(c.samples)
	r, err := SweepCalibration(lo, hi)
	if err != nil {
		return SweepResult{}, err
	}
	b.capt[n] = capture{rawLow: -1, rawHigh: -1}
	return r, nil
}

// ExpCaptures is each input's sweep, as it stands.
func (b *Bridge) ExpCaptures() [sparkx.ExpInputs]Capture {
	b.mu.Lock()
	defer b.mu.Unlock()
	var out [sparkx.ExpInputs]Capture
	for n := range b.capt {
		out[n] = b.capt[n].view()
	}
	return out
}

func (c *capture) view() Capture {
	if !c.on {
		return Capture{Low: -1, High: -1, RawLow: -1, RawHigh: -1}
	}
	lo, hi := sweepExtremes(c.samples)
	span := hi - lo
	return Capture{
		On: true, Low: lo, High: hi, RawLow: c.rawLow, RawHigh: c.rawHigh,
		Samples:   len(c.samples),
		Reversals: c.reversals,
		Ready: lo >= 0 && span >= MinSweepSpan &&
			(c.reversals > 0 || span*100 >= mapping.ExpRawMax*wideSweepPercent),
		StartedAt: c.startedAt.UnixMilli(),
		MovedAt:   c.movedAt.UnixMilli(),
		ExtremeAt: c.extremeAt.UnixMilli(),
	}
}

// recordLocked adds one raw value to input n's sweep, if one is on.
func (b *Bridge) recordLocked(n, raw int) {
	if n < 0 || n >= sparkx.ExpInputs || raw < 0 {
		return
	}
	c := &b.capt[n]
	if !c.on {
		return
	}
	now := b.now()
	if len(c.samples) < maxSweepSamples {
		c.samples = append(c.samples, raw)
	}
	if len(c.samples) == 1 {
		c.rawLow, c.rawHigh, c.peak, c.anchor = raw, raw, raw, raw
		return
	}
	if raw < c.rawLow {
		c.rawLow, c.extremeAt = raw, now
	}
	if raw > c.rawHigh {
		c.rawHigh, c.extremeAt = raw, now
	}
	span := c.rawHigh - c.rawLow
	// Moving, as opposed to a resting foot's jitter: 1.5 % of the span, at least 300.
	if d := raw - c.anchor; max(d, -d) > max(300, span*3/200) {
		c.anchor, c.movedAt = raw, now
	}
	// A turn is going back 15 % of the span from the furthest point of the run.
	back := max(300, span*15/100)
	switch {
	case c.dir == 0 && raw > c.peak+back:
		c.dir, c.peak = 1, raw
	case c.dir == 0 && raw < c.peak-back:
		c.dir, c.peak = -1, raw
	case c.dir == 0:
	case c.dir*(raw-c.peak) > 0: // further the same way
		c.peak = raw
	case c.dir*(c.peak-raw) > back: // turned
		if span >= MinSweepSpan {
			c.reversals++
		}
		c.dir, c.peak = -c.dir, raw
	}
}
