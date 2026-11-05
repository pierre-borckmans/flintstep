package bridge

import (
	"sync"
	"testing"
	"time"

	"flintstep/internal/mapping"
)

type widenLog struct {
	mu  sync.Mutex
	got [][3]int
}

func (w *widenLog) add(n, lo, hi int) {
	w.mu.Lock()
	w.got = append(w.got, [3]int{n, lo, hi})
	w.mu.Unlock()
}

func (w *widenLog) all() [][3]int {
	w.mu.Lock()
	defer w.mu.Unlock()
	return append([][3]int(nil), w.got...)
}

// widenRig is a bridge with exp 1 calibrated heel..toe and a log of its proposals.
func widenRig(t *testing.T, heel, toe int) (*Bridge, *clock, *widenLog) {
	t.Helper()
	cfg := mapping.Default()
	cfg.Exp[0].Min, cfg.Exp[0].Max = heel, toe
	c := &clock{t: time.Unix(1_000_000, 0)}
	w := &widenLog{}
	b := New(cfg, nil, Options{Now: c.now, OnWiden: w.add})
	t.Cleanup(b.Close)
	return b, c, w
}

func feedAt(b *Bridge, c *clock, n int, vs ...int) {
	for _, v := range vs {
		c.advance(20 * time.Millisecond)
		b.onExp(n, v)
	}
}

// last is the latest proposal, or zero.
func last(w interface{ all() [][3]int }) [3]int {
	got := w.all()
	if len(got) == 0 {
		return [3]int{}
	}
	return got[len(got)-1]
}

func TestWidenTheHeel(t *testing.T) {
	b, c, w := widenRig(t, 3000, 27000) // margin 240
	feedAt(b, c, 0, 2900, 2800, 10000)  // within the margin: nothing
	if got := w.all(); len(got) != 0 {
		t.Fatalf("proposed inside the margin: %v", got)
	}
	// One reading past the heel is enough: a pedal parked there sends nothing more.
	feedAt(b, c, 0, 300)
	if got := last(w); got[0] != 0 || got[1] >= 3000 || got[1] < 300 || got[2] != 27000 {
		t.Fatalf("proposal %v, want a heel between 300 and 3000", got)
	}
	n := len(w.all())
	// The same value again proposes nothing new: the new heel already covers it.
	feedAt(b, c, 0, 300)
	if got := w.all(); len(got) != n {
		t.Errorf("proposed again: %v", got)
	}
}

func TestWidenTheToeAndNeverNarrow(t *testing.T) {
	b, c, w := widenRig(t, 27000, 3000) // toe reads lower: heel is the high end
	feedAt(b, c, 0, 28000, 28500, 28400)
	if got := last(w); got[1] != 3000 || got[2] <= 27000 || got[2] > 28500 {
		t.Fatalf("proposal %v, want the high end widened toward 28500", got)
	}
	n := len(w.all())
	feedAt(b, c, 0, 15000, 5000, 3100) // inside: nothing
	if got := w.all(); len(got) != n {
		t.Errorf("proposed a narrower range: %v", got)
	}
}

// The real EX-P case: it changes fastest near the heel and sends nothing at rest, so a
// quick move to a new heel is a few far-apart samples ending in ONE at the heel.
func TestWidenOnASingleReadingAtTheEnd(t *testing.T) {
	b, c, w := widenRig(t, 21448, 27500)
	feedAt(b, c, 0, 15000, 6000, 104)
	if got := last(w); got[1] > 104+400 {
		t.Fatalf("proposal %v, want the heel near 104", got)
	}
}

func TestWidenWaitsForCalibrationAndSweeps(t *testing.T) {
	b, c, w := widenRig(t, 0, mapping.ExpRawMax)
	feedAt(b, c, 0, 0, 0, 0, mapping.ExpRawMax, mapping.ExpRawMax, mapping.ExpRawMax)
	if got := w.all(); len(got) != 0 {
		t.Errorf("the whole jack widened: %v", got)
	}

	b2, c2, w2 := widenRig(t, 3000, 27000)
	b2.mu.Lock()
	b2.capt[0].on = true // a sweep is calibrating it
	b2.mu.Unlock()
	feedAt(b2, c2, 0, 100, 100, 100)
	if got := w2.all(); len(got) != 0 {
		t.Errorf("widened during a sweep: %v", got)
	}
}

// Applying a config starts over from its calibration.
func TestWidenResetsOnApply(t *testing.T) {
	b, c, w := widenRig(t, 3000, 27000)
	feedAt(b, c, 0, 1000, 1000, 1000)
	cfg := b.Config()
	cfg.Exp[0].Min = 1240
	if _, err := b.Apply(cfg); err != nil {
		t.Fatal(err)
	}
	feedAt(b, c, 0, 900, 900, 900)
	got := w.all()
	if len(got) != 2 || got[1][1] != 900+258 {
		t.Errorf("proposals %v, want a second from the applied heel", got)
	}
}
