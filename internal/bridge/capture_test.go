package bridge

import (
	"errors"
	"sync"
	"testing"
	"time"

	"flintstep/internal/mapping"
)

// realPedal is a rig with a real cable in jack 1 resting at raw `rest`.
func realPedal(t *testing.T, rest int) *simRig {
	t.Helper()
	r := setupSim(t, mapping.Default())
	st := withCables(true, false)
	st.ExpRaw[0] = rest
	r.p.set(st)
	return r
}

// feed sends raw values from a real pedal on input n, 20 ms apart.
func (r *simRig) feed(n int, vs ...int) {
	for _, v := range vs {
		r.c.advance(20 * time.Millisecond)
		r.b.onExp(n, v)
	}
}

// ramp is from..to in steps of `step` (either way), both ends included.
func ramp(from, to, step int) []int {
	var vs []int
	if to < from {
		step = -step
	}
	for v := from; (step > 0 && v < to) || (step < 0 && v > to); v += step {
		vs = append(vs, v)
	}
	return append(vs, to)
}

func TestSweepKeepsTheExtremesOfEveryPass(t *testing.T) {
	r := realPedal(t, 21448) // resting half way, as when "Set heel" went wrong
	if err := r.b.StartExpSweep(0); err != nil {
		t.Fatal(err)
	}
	c := r.b.ExpCaptures()[0]
	if !c.On || c.Low != 21448 || c.High != 21448 || c.Samples != 1 {
		t.Fatalf("start = %+v, want on from the resting value", c)
	}
	// Sloppy: up short of the toe, down to the heel, up to the toe, part way back.
	r.feed(0, ramp(21448, 26000, 900)...)
	r.feed(0, ramp(26000, 256, 1500)...)
	r.feed(0, 256, 256)
	r.feed(0, ramp(256, 27500, 1500)...)
	r.feed(0, 27500)
	r.feed(0, ramp(27500, 15000, 1500)...)
	c = r.b.ExpCaptures()[0]
	if c.Low != 256 || c.High != 27500 || c.RawLow != 256 || c.RawHigh != 27500 {
		t.Errorf("extremes %+v, want 256..27500", c)
	}
	if c.Reversals < 3 || !c.Ready {
		t.Errorf("reversals %d ready %v, want at least 3 and ready", c.Reversals, c.Ready)
	}
	got, err := r.b.FinishExpSweep(0)
	if err != nil {
		t.Fatal(err)
	}
	want := SweepResult{Low: 256, High: 27500, Heel: 256 + 272, Toe: 27500 - 272}
	if got != want {
		t.Errorf("FinishExpSweep = %+v, want %+v", got, want)
	}
	if r.b.ExpCaptures()[0].On {
		t.Error("the sweep is still on after finishing")
	}
	// Nothing is saved or applied by the bridge.
	if x := r.b.Config().Exp[0]; x.Min != 0 || x.Max != mapping.ExpRawMax {
		t.Errorf("the bridge applied %d..%d itself", x.Min, x.Max)
	}
}

// Every value counts, not only the ones a 20 Hz state push would have caught: a flick
// to the toe and back between two pushes still sets the toe.
func TestSweepSeesEveryValue(t *testing.T) {
	r := realPedal(t, 300)
	if err := r.b.StartExpSweep(0); err != nil {
		t.Fatal(err)
	}
	for _, v := range []int{300, 9000, 20000, 27000, 27400, 27000, 15000, 2000, 320} {
		r.c.advance(5 * time.Millisecond)
		r.b.onExp(0, v)
	}
	if c := r.b.ExpCaptures()[0]; c.Low != 300 || c.High != 27400 {
		t.Errorf("extremes %d..%d, want 300..27400", c.Low, c.High)
	}
}

// The real EX-P case that the old glitch filter got wrong: a fast sweep whose heel is a
// single sample, far from the one before it, then silence (the pedal sends nothing at
// rest). The heel must be kept.
func TestSweepKeepsALoneSampleAtTheEnd(t *testing.T) {
	r := realPedal(t, 20000)
	if err := r.b.StartExpSweep(0); err != nil {
		t.Fatal(err)
	}
	r.feed(0, 20000, 24000, 27500, 22000, 14000, 5000, 104)
	c := r.b.ExpCaptures()[0]
	if c.Low != 104 || c.High != 27500 {
		t.Errorf("extremes %d..%d, want 104..27500", c.Low, c.High)
	}
}

func TestSweepExtremes(t *testing.T) {
	for _, c := range []struct {
		in     []int
		lo, hi int
	}{
		{nil, -1, -1},
		{[]int{500}, 500, 500},
		{[]int{0, 10000, 10100, 20000, 20100, 65535}, 0, 65535},
	} {
		lo, hi := sweepExtremes(c.in)
		if lo != c.lo || hi != c.hi {
			t.Errorf("sweepExtremes(%v) = %d..%d, want %d..%d", c.in, lo, hi, c.lo, c.hi)
		}
	}
}

func TestSweepTooSmallKeepsGoing(t *testing.T) {
	r := realPedal(t, 20000)
	if err := r.b.StartExpSweep(0); err != nil {
		t.Fatal(err)
	}
	r.feed(0, ramp(20000, 22000, 500)...)
	if c := r.b.ExpCaptures()[0]; c.Ready {
		t.Errorf("a 2000 span is ready: %+v", c)
	}
	if _, err := r.b.FinishExpSweep(0); !errors.Is(err, ErrSweepTooSmall) {
		t.Fatalf("FinishExpSweep = %v, want ErrSweepTooSmall", err)
	}
	if !r.b.ExpCaptures()[0].On {
		t.Fatal("a refused finish ended the sweep")
	}
	r.feed(0, ramp(22000, 500, 500)...)
	if got, err := r.b.FinishExpSweep(0); err != nil || got.Low != 500 || got.High != 22000 {
		t.Errorf("after rocking further: %+v, %v", got, err)
	}
}

func TestSweepCancel(t *testing.T) {
	r := realPedal(t, 256)
	if err := r.b.StartExpSweep(0); err != nil {
		t.Fatal(err)
	}
	r.feed(0, ramp(256, 27500, 2000)...)
	if err := r.b.CancelExpSweep(0); err != nil {
		t.Fatal(err)
	}
	if c := r.b.ExpCaptures()[0]; c.On || c.Low != -1 {
		t.Errorf("after cancel: %+v", c)
	}
	if _, err := r.b.FinishExpSweep(0); err == nil {
		t.Error("finishing a cancelled sweep worked")
	}
	r.feed(0, 100) // values after a cancel go nowhere
	if c := r.b.ExpCaptures()[0]; c.Samples != 0 {
		t.Errorf("a cancelled sweep kept a value: %+v", c)
	}
}

func TestSweepNeedsACable(t *testing.T) {
	r := setupSim(t, mapping.Default())
	if err := r.b.StartExpSweep(0); err == nil {
		t.Error("a sweep started on an empty jack")
	}
	if err := r.b.StartExpSweep(2); err == nil {
		t.Error("a sweep started on input 3")
	}
}

// A simulated pedal sweeps like a real one: its values go through the same step.
func TestSweepSimulatedPedal(t *testing.T) {
	r := setupSim(t, mapping.Default())
	if err := r.b.SimulateExp(1, true); err != nil {
		t.Fatal(err)
	}
	r.move(t, 1, 0.5)
	if err := r.b.StartExpSweep(1); err != nil {
		t.Fatal(err)
	}
	for _, f := range []float64{0.8, 0.9, 0.89, 0.6, 0.2, 0.05, 0.06, 0.3} {
		r.move(t, 1, f)
	}
	c := r.b.ExpCaptures()[1]
	if c.Low != FractionRaw(0.05) || c.High != FractionRaw(0.9) || c.Reversals < 2 || !c.Ready {
		t.Errorf("simulated sweep %+v", c)
	}
	if r.b.ExpCaptures()[0].On {
		t.Error("input 1 is sweeping too")
	}
}

// Ready needs the pedal to have turned back, unless it covered most of the jack.
func TestSweepReadyNeedsATurn(t *testing.T) {
	r := realPedal(t, 256)
	if err := r.b.StartExpSweep(0); err != nil {
		t.Fatal(err)
	}
	r.feed(0, ramp(256, 27500, 1000)...)
	if c := r.b.ExpCaptures()[0]; c.Ready || c.Reversals != 0 {
		t.Errorf("one way only: %+v", c)
	}
	r.feed(0, ramp(27500, 20000, 1000)...)
	if c := r.b.ExpCaptures()[0]; !c.Ready || c.Reversals != 1 {
		t.Errorf("after turning back: %+v", c)
	}

	r2 := realPedal(t, 0)
	if err := r2.b.StartExpSweep(0); err != nil {
		t.Fatal(err)
	}
	r2.feed(0, ramp(0, 60000, 3000)...)
	if c := r2.b.ExpCaptures()[0]; !c.Ready {
		t.Errorf("most of the jack one way: %+v", c)
	}
}

// MovedAt follows real movement, not a resting foot's jitter.
func TestSweepMovedAt(t *testing.T) {
	r := realPedal(t, 256)
	if err := r.b.StartExpSweep(0); err != nil {
		t.Fatal(err)
	}
	r.feed(0, ramp(256, 27500, 2000)...)
	moved := r.b.ExpCaptures()[0].MovedAt
	r.feed(0, 27450, 27480, 27440)
	if c := r.b.ExpCaptures()[0]; c.MovedAt != moved {
		t.Errorf("jitter moved MovedAt from %d to %d", moved, c.MovedAt)
	}
	r.feed(0, 20000)
	if c := r.b.ExpCaptures()[0]; c.MovedAt <= moved {
		t.Error("a real move did not update MovedAt")
	}
}

func TestSweepCalibration(t *testing.T) {
	got, err := SweepCalibration(256, 27500)
	if err != nil || got.Heel != 528 || got.Toe != 27228 {
		t.Errorf("SweepCalibration(256, 27500) = %+v, %v", got, err)
	}
	for _, c := range [][2]int{{1000, 4999}, {-1, 30000}, {30000, 1000}} {
		if _, err := SweepCalibration(c[0], c[1]); !errors.Is(err, ErrSweepTooSmall) {
			t.Errorf("SweepCalibration(%d, %d) = %v, want ErrSweepTooSmall", c[0], c[1], err)
		}
	}
}

// OnRaw sees every value, real and simulated, in order.
func TestOnRaw(t *testing.T) {
	var mu sync.Mutex
	var got [][2]int
	b := New(mapping.Default(), nil, Options{OnRaw: func(n, raw int) {
		mu.Lock()
		got = append(got, [2]int{n, raw})
		mu.Unlock()
	}})
	t.Cleanup(b.Close)
	b.onExp(0, 10)
	b.onExp(1, 20)
	b.onExp(0, 30)
	mu.Lock()
	defer mu.Unlock()
	if len(got) != 3 || got[0] != [2]int{0, 10} || got[1] != [2]int{1, 20} || got[2] != [2]int{0, 30} {
		t.Errorf("OnRaw saw %v", got)
	}
}
