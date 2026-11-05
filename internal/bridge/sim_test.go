package bridge

import (
	"bytes"
	"errors"
	"sync"
	"testing"
	"time"

	"flintstep/internal/ble"
	"flintstep/internal/mapping"
	"flintstep/internal/sparkx"
)

// statusPedal is a pedal whose status the test sets.
type statusPedal struct {
	fakePedal
	smu sync.Mutex
	st  ble.Status
}

func (p *statusPedal) Status() ble.Status {
	p.smu.Lock()
	defer p.smu.Unlock()
	return p.st
}

func (p *statusPedal) set(st ble.Status) {
	p.smu.Lock()
	p.st = st
	p.smu.Unlock()
}

func withCables(cable0, cable1 bool) ble.Status {
	st := ble.Status{State: ble.StateConnected, ExpRaw: [sparkx.ExpInputs]int{-1, -1}}
	st.Cables = [sparkx.ExpInputs]bool{cable0, cable1}
	return st
}

type simRig struct {
	b     *Bridge
	p     *statusPedal
	out   *fakeOut
	c     *clock
	trig  *triggerLog
	mu    sync.Mutex
	acts  []Activity
	pings int
}

func setupSim(t *testing.T, cfg mapping.Config) *simRig {
	t.Helper()
	r := &simRig{c: &clock{t: time.Unix(1_000_000, 0)}, out: &fakeOut{}, trig: &triggerLog{}}
	r.b = New(cfg, r.out, Options{
		Now:       r.c.now,
		OnTrigger: r.trig.add,
		OnActivity: func(a Activity) {
			r.mu.Lock()
			r.acts = append(r.acts, a)
			r.mu.Unlock()
		},
		OnSim: func() {
			r.mu.Lock()
			r.pings++
			r.mu.Unlock()
		},
	})
	t.Cleanup(r.b.Close)
	r.p = &statusPedal{}
	r.p.set(withCables(false, false))
	r.b.SetPedal(r.p)
	return r
}

// move advances the clock past the rate limit and sets input n's position.
func (r *simRig) move(t *testing.T, n int, f float64) {
	t.Helper()
	r.c.advance(simEvery)
	if err := r.b.SetSimExp(n, f); err != nil {
		t.Fatalf("SetSimExp(%d, %v): %v", n, f, err)
	}
}

func cc(n, v int) []byte { return []byte{0xB0, byte(n), byte(v)} }

// ccValues are the values of CC n sent, in order.
func ccValues(msgs [][]byte, n int) []int {
	var vs []int
	for _, m := range msgs {
		if len(m) == 3 && m[0] == 0xB0 && int(m[1]) == n {
			vs = append(vs, int(m[2]))
		}
	}
	return vs
}

func TestSimReportsCableAndSendsCC(t *testing.T) {
	r := setupSim(t, mapping.Default()) // exp 1 = CC 11 on channel 1
	if err := r.b.SimulateExp(0, true); err != nil {
		t.Fatal(err)
	}
	st := r.b.Status()
	if !st.Cables[0] || st.ExpRaw[0] != 0 {
		t.Errorf("status cables %v expRaw %v, want a cable in jack 1 reading 0", st.Cables, st.ExpRaw)
	}
	if st.Cables[1] || st.ExpRaw[1] != -1 {
		t.Errorf("jack 2 should be the pedal's own: cables %v expRaw %v", st.Cables, st.ExpRaw)
	}
	if got := r.b.ExpSim(); got != [2]bool{true, false} {
		t.Errorf("ExpSim = %v", got)
	}
	if !has(r.out.all(), cc(11, 0)) {
		t.Errorf("turning on at the heel sent % x, want CC 11 = 0", r.out.all())
	}

	r.move(t, 0, 1)
	if !has(r.out.all(), cc(11, 127)) {
		t.Fatalf("toe sent % x, want CC 11 = 127", r.out.all())
	}
	if got := r.b.Status().ExpRaw[0]; got != mapping.ExpRawMax {
		t.Errorf("expRaw at the toe = %d, want %d", got, mapping.ExpRawMax)
	}
	r.mu.Lock()
	n, pings := len(r.acts), r.pings
	r.mu.Unlock()
	if n == 0 {
		t.Error("simulated CCs did not reach the activity log")
	}
	if pings == 0 {
		t.Error("OnSim never called")
	}
}

func TestSimAppliesCalibrationAndInvert(t *testing.T) {
	cfg := mapping.Default()
	cfg.Exp[0].Min, cfg.Exp[0].Max = 49152, 16384 // toe reads lower than the heel
	r := setupSim(t, cfg)
	if err := r.b.SimulateExp(0, true); err != nil {
		t.Fatal(err)
	}
	// Raw 0 is past the toe here.
	if got := ccValues(r.out.all(), 11); len(got) != 1 || got[0] != 127 {
		t.Fatalf("raw 0 with heel 49152 toe 16384 sent CC 11 %v, want [127]", got)
	}
	r.move(t, 0, 0.5) // raw 32768: the middle of the calibrated travel
	if got := ccValues(r.out.all(), 11); got[len(got)-1] != 64 {
		t.Errorf("middle sent CC 11 %v, want 64 last", got)
	}
	r.move(t, 0, 1) // raw 65535: past the heel
	if got := ccValues(r.out.all(), 11); got[len(got)-1] != 0 {
		t.Errorf("raw 65535 sent CC 11 %v, want 0 last", got)
	}

	cfg.Exp[0].Invert = true
	if _, err := r.b.Apply(cfg); err != nil {
		t.Fatal(err)
	}
	r.c.advance(simEvery)
	r.b.simStep() // a new calibration reaches a parked pedal without moving it
	if got := ccValues(r.out.all(), 11); got[len(got)-1] != 127 {
		t.Errorf("inverted, the heel sent CC 11 %v, want 127 last", got)
	}
}

func TestSimRateLimit(t *testing.T) {
	r := setupSim(t, mapping.Default())
	if err := r.b.SimulateExp(0, true); err != nil {
		t.Fatal(err)
	}
	r.move(t, 0, 0.5)
	before := len(r.out.all())
	// Faster than simEvery: held back.
	for _, f := range []float64{0.6, 0.7, 0.8} {
		r.c.advance(simEvery / 4)
		if err := r.b.SetSimExp(0, f); err != nil {
			t.Fatal(err)
		}
	}
	if got := len(r.out.all()); got != before {
		t.Fatalf("%d messages went out inside the rate limit", got-before)
	}
	r.c.advance(simEvery)
	r.b.simStep()
	if got := ccValues(r.out.all(), 11); got[len(got)-1] != 102 { // 0.8 * 127
		t.Errorf("after the limit CC 11 went %v, want the latest position (102) last", got)
	}
}

func TestSimSweep(t *testing.T) {
	r := setupSim(t, mapping.Default())
	if err := r.b.SimSweep(0, true); err != nil { // turns the simulation on
		t.Fatal(err)
	}
	if !r.b.ExpSim()[0] || !r.b.ExpSweep()[0] {
		t.Fatal("SimSweep did not turn the simulation on and sweep")
	}
	// One period in 100 ms steps: up to the toe at the half, back to the heel.
	var seen []int
	for range int(SweepPeriod / (100 * time.Millisecond)) {
		r.c.advance(100 * time.Millisecond)
		r.b.simStep()
		seen = append(seen, r.b.Status().ExpRaw[0])
	}
	half := len(seen)/2 - 1
	if seen[half] != mapping.ExpRawMax {
		t.Errorf("at half a period raw = %d, want the toe", seen[half])
	}
	for i := 1; i <= half; i++ {
		if seen[i] <= seen[i-1] {
			t.Fatalf("not rising on the way up: %v", seen)
		}
	}
	for i := half + 1; i < len(seen); i++ {
		if seen[i] >= seen[i-1] {
			t.Fatalf("not falling on the way down: %v", seen)
		}
	}
	if seen[len(seen)-1] != 0 {
		t.Errorf("a whole period ends at %d, want the heel", seen[len(seen)-1])
	}
	// Eased: slow near the ends, fast in the middle.
	if d0, dm := seen[1]-seen[0], seen[half/2+1]-seen[half/2]; d0 >= dm {
		t.Errorf("not eased: step %d at the heel, %d mid-travel", d0, dm)
	}
	if vs := ccValues(r.out.all(), 11); len(vs) < 20 {
		t.Errorf("a sweep sent only %d CCs", len(vs))
	}

	// Off: it stays where it got to.
	r.c.advance(time.Second) // a quarter: halfway up
	if err := r.b.SimSweep(0, false); err != nil {
		t.Fatal(err)
	}
	if r.b.ExpSweep()[0] {
		t.Error("ExpSweep still on after SimSweep(false)")
	}
	parked := r.b.Status().ExpRaw[0]
	if parked < 32000 || parked > 33500 {
		t.Errorf("stopped a quarter into the sweep at %d, want about halfway", parked)
	}
	n := len(r.out.all())
	for range 5 {
		r.c.advance(100 * time.Millisecond)
		r.b.simStep()
	}
	if got := len(r.out.all()); got != n {
		t.Errorf("%d messages after the sweep stopped", got-n)
	}

	// A sweep starts from where the pedal is.
	if err := r.b.SimSweep(0, true); err != nil {
		t.Fatal(err)
	}
	if got := r.b.Status().ExpRaw[0]; got < parked-200 || got > parked+200 {
		t.Errorf("sweep restarted at %d, want near %d", got, parked)
	}
	// Grabbing the pedal stops the sweep.
	r.move(t, 0, 0.25)
	r.c.advance(time.Second)
	r.b.simStep()
	if got := r.b.Status().ExpRaw[0]; got != FractionRaw(0.25) {
		t.Errorf("after SetSimExp the pedal moved on to %d", got)
	}
}

func TestSimSweepStopsOnClose(t *testing.T) {
	// The real clock: the loop has to make progress on its own.
	out := &fakeOut{}
	b := New(mapping.Default(), out, Options{})
	b.SetPedal(&statusPedal{})
	if err := b.SimSweep(0, true); err != nil {
		t.Fatal(err)
	}
	deadline := time.Now().Add(2 * time.Second)
	for len(ccValues(out.all(), 11)) < 3 {
		if time.Now().After(deadline) {
			b.Close()
			t.Fatal("the sweep loop sent nothing on its own")
		}
		time.Sleep(10 * time.Millisecond)
	}
	b.Close()
	for {
		b.mu.Lock()
		running := b.simLoop
		b.mu.Unlock()
		if !running {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("the sweep loop outlived Close")
		}
		time.Sleep(5 * time.Millisecond)
	}
	n := len(out.all())
	time.Sleep(5 * simEvery)
	if got := len(out.all()); got != n {
		t.Errorf("%d messages after Close", got-n)
	}
	if err := b.SimSweep(0, true); !errors.Is(err, ErrClosed) {
		t.Errorf("SimSweep after Close = %v, want ErrClosed", err)
	}
}

func TestSimLoopEndsWhenOff(t *testing.T) {
	b := New(mapping.Default(), &fakeOut{}, Options{})
	t.Cleanup(b.Close)
	if err := b.SimulateExp(1, true); err != nil {
		t.Fatal(err)
	}
	if err := b.SimulateExp(1, false); err != nil {
		t.Fatal(err)
	}
	deadline := time.Now().Add(time.Second)
	for {
		b.mu.Lock()
		running := b.simLoop
		b.mu.Unlock()
		if !running {
			return
		}
		if time.Now().After(deadline) {
			t.Fatal("the loop kept running with nothing simulated")
		}
		time.Sleep(5 * time.Millisecond)
	}
}

func TestSimRealCableTakesOver(t *testing.T) {
	r := setupSim(t, engageConfig())
	if err := r.b.SimulateExp(0, true); err != nil {
		t.Fatal(err)
	}
	r.move(t, 0, 0.5)
	if !has(r.out.all(), trigOn) {
		t.Fatalf("halfway did not engage the trigger: % x", r.out.all())
	}
	// A real value before the status reports the cable: still simulated, ignored.
	h := r.b.Handlers()
	n := len(r.out.all())
	h.Exp(0, mapping.ExpRawMax)
	if got := len(r.out.all()); got != n {
		t.Errorf("a real value on a simulated jack sent % x", r.out.all()[n:])
	}

	st := withCables(true, false)
	st.ExpRaw[0] = 1000
	r.p.set(st)
	h.Status(st)
	if r.b.ExpSim()[0] {
		t.Fatal("a real cable did not end the simulation")
	}
	if !has(r.out.all()[n:], trigOff) {
		t.Errorf("the takeover did not let go of the trigger: % x", r.out.all()[n:])
	}
	if got := r.b.Status().ExpRaw[0]; got != 1000 {
		t.Errorf("expRaw after the takeover = %d, want the real 1000", got)
	}
	h.Exp(0, mapping.ExpRawMax)
	if got := ccValues(r.out.all(), 11); got[len(got)-1] != 127 {
		t.Errorf("real values do not flow after the takeover: CC 11 %v", got)
	}

	// And with the cable in, simulation is refused.
	if err := r.b.SimulateExp(0, true); err == nil {
		t.Error("SimulateExp on a jack with a real cable worked")
	}
	if err := r.b.SetSimExp(0, 0.5); err == nil {
		t.Error("SetSimExp on a jack with a real cable worked")
	}
}

func TestSimOffReleasesTrigger(t *testing.T) {
	r := setupSim(t, engageConfig())
	if err := r.b.SimulateExp(0, true); err != nil {
		t.Fatal(err)
	}
	r.move(t, 0, 0.5)
	if !r.b.ExpTriggers()[0] {
		t.Fatal("trigger not engaged halfway")
	}
	n := len(r.out.all())
	if err := r.b.SimulateExp(0, false); err != nil {
		t.Fatal(err)
	}
	if sent := r.out.all()[n:]; len(sent) != 1 || !bytes.Equal(sent[0], trigOff) {
		t.Errorf("off sent % x, want only the trigger's release", sent)
	}
	if r.b.ExpTriggers()[0] {
		t.Error("trigger still engaged after the simulation went off")
	}
	if got := r.trig.all(); got[len(got)-1][0] {
		t.Errorf("OnTrigger last reported %v", got[len(got)-1])
	}
	st := r.b.Status()
	if st.Cables[0] || st.ExpRaw[0] != -1 || r.b.ExpSim()[0] {
		t.Errorf("after off: cables %v expRaw %v sim %v, want the pedal's own", st.Cables, st.ExpRaw, r.b.ExpSim())
	}
	// A status without a cable in jack 1 while it was simulated does not release it.
	if err := r.b.SimulateExp(0, true); err != nil {
		t.Fatal(err)
	}
	r.move(t, 0, 0.5)
	n = len(r.out.all())
	r.b.Handlers().Status(withCables(false, false))
	if has(r.out.all()[n:], trigOff) {
		t.Error("a cable-less status let go of a simulated jack's trigger")
	}
}

func TestSimBadInput(t *testing.T) {
	r := setupSim(t, mapping.Default())
	for _, n := range []int{-1, 2} {
		if r.b.SimulateExp(n, true) == nil || r.b.SetSimExp(n, 0.5) == nil || r.b.SimSweep(n, true) == nil {
			t.Errorf("input %d accepted", n)
		}
	}
}

func TestFractionRaw(t *testing.T) {
	for f, want := range map[float64]int{-1: 0, 0: 0, 0.5: 32768, 1: 65535, 2: 65535} {
		if got := FractionRaw(f); got != want {
			t.Errorf("FractionRaw(%v) = %d, want %d", f, got, want)
		}
	}
}
