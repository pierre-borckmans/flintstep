package mapping

import (
	"math"
	"reflect"
	"testing"
)

// Expression triggers: a switch faked from the pedal's position. Every test runs on
// the injected clock (at(ms)), so off delays are exact.

// raw is p percent of the jack's whole range: the default calibration's travel.
func raw(p float64) int { return int(math.Round(p * ExpRawMax / 100)) }

var (
	trigCC  = Action{Kind: KindCC, Channel: 1, Number: 102, Value: 127, Mode: Momentary}
	trigTog = Action{Kind: KindCC, Channel: 1, Number: 102, Value: 127, Mode: Toggle}
)

func engageCfg(edit func(t *ExpTrigger)) Config {
	return cfgWith(func(c *Config) {
		c.Exp[0].Trigger = ExpTrigger{Mode: TriggerEngage, Action: trigCC, Threshold: 4, OffDelayMS: 400}
		if edit != nil {
			edit(&c.Exp[0].Trigger)
		}
	})
}

func toeCfg(a Action) Config {
	return cfgWith(func(c *Config) {
		c.Exp[0].Trigger = ExpTrigger{Mode: TriggerToe, Action: a, Threshold: 96}
	})
}

// trig keeps only the trigger's messages (CC 102): the expression CC moves alongside
// and is TestEngineExp's business.
func trig(msgs [][]byte) [][]byte {
	var out [][]byte
	for _, m := range msgs {
		if len(m) == 3 && m[0]&0xF0 == stCC && m[1] == 102 {
			out = append(out, m)
		}
	}
	return out
}

type tstep struct {
	ms   int
	raw  int // -1 = a Tick
	want [][]byte
}

func feed(ms, r int, want ...[]byte) tstep { return tstep{ms, r, want} }
func tickT(ms int, want ...[]byte) tstep   { return tstep{ms, -1, want} }

func runT(t *testing.T, e *Engine, steps []tstep) {
	t.Helper()
	for i, s := range steps {
		var got [][]byte
		if s.raw < 0 {
			got = e.Tick(at(s.ms)).Msgs()
		} else {
			got = e.Exp(0, s.raw, at(s.ms)).Msgs()
		}
		got = trig(got)
		if len(got) == 0 && len(s.want) == 0 {
			continue
		}
		if !reflect.DeepEqual(got, s.want) {
			t.Fatalf("step %d (%d ms, raw %d): got %s, want %s", i, s.ms, s.raw, describeAll(got), describeAll(s.want))
		}
	}
}

var (
	on  = cc(1, 102, 127)
	off = cc(1, 102, 0)
)

func TestTriggerEngageOnRise(t *testing.T) {
	e := NewEngine(engageCfg(nil))
	runT(t, e, []tstep{
		feed(0, raw(0)),
		feed(10, raw(3)),     // not yet
		feed(20, raw(5), on), // past 4 %
		feed(30, raw(60)),    // already on
		feed(40, raw(100)),
	})
	if !e.ExpTriggers()[0] {
		t.Fatal("ExpTriggers()[0] = false while engaged")
	}
}

func TestTriggerEngageSendsPressBeforeTheCC(t *testing.T) {
	e := NewEngine(engageCfg(nil))
	e.Exp(0, 0, at(0)).Msgs()
	got := e.Exp(0, raw(50), at(10)).Msgs()
	want := [][]byte{on, cc(1, 11, 64)}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %s, want %s", describeAll(got), describeAll(want))
	}
}

func TestTriggerNoChatterAtTheBoundary(t *testing.T) {
	e := NewEngine(engageCfg(func(tr *ExpTrigger) { tr.OffDelayMS = 0 }))
	// Noise either side of 4 %: one press, and nothing until it falls under 1 %.
	steps := []tstep{feed(0, raw(0)), feed(10, raw(4.2), on)}
	for i, p := range []float64{3.8, 4.3, 3.5, 4.1, 2.0, 4.4, 1.5} {
		steps = append(steps, feed(20+10*i, raw(p)))
	}
	steps = append(steps, feed(200, raw(0.5), off), feed(210, raw(0.8)), feed(220, raw(0.2)))
	runT(t, e, steps)
}

func TestTriggerOffDelayHoldsThroughAHeelTouch(t *testing.T) {
	e := NewEngine(engageCfg(nil))
	runT(t, e, []tstep{
		feed(0, raw(50), on),
		feed(100, raw(0)), // back on the heel: the 400 ms start
		tickT(300),
		feed(350, raw(30)), // rocked forward again inside the delay
		tickT(600),         // the old timer would have run out at 500
		tickT(1000),
		feed(1100, raw(0)), // heel again
		tickT(1499),
		tickT(1500, off), // 400 ms later
		tickT(2000),
	})
	if e.ExpTriggers()[0] {
		t.Fatal("still engaged after the off delay")
	}
	if e.Pending() {
		t.Fatal("Pending after the off delay ran out")
	}
}

func TestTriggerOffDelayIsPending(t *testing.T) {
	e := NewEngine(engageCfg(nil))
	e.Exp(0, raw(50), at(0)).Msgs()
	if e.Pending() {
		t.Fatal("Pending while the pedal is up")
	}
	e.Exp(0, 0, at(100)).Msgs()
	if !e.Pending() {
		t.Fatal("not Pending during the off delay")
	}
}

func TestTriggerZeroOffDelayReleasesAtOnce(t *testing.T) {
	e := NewEngine(engageCfg(func(tr *ExpTrigger) { tr.OffDelayMS = 0 }))
	runT(t, e, []tstep{feed(0, raw(50), on), feed(10, raw(0), off)})
}

func TestTriggerOffDelayFiresBeforeALateValue(t *testing.T) {
	// No Tick came in time: the next value fires the overdue release first.
	e := NewEngine(engageCfg(nil))
	runT(t, e, []tstep{feed(0, raw(50), on), feed(10, 0), feed(900, raw(50), off, on)})
}

func TestTriggerToeMomentary(t *testing.T) {
	e := NewEngine(toeCfg(trigCC))
	runT(t, e, []tstep{
		feed(0, raw(0)),
		feed(10, raw(80)),
		feed(20, raw(97), on),
		feed(30, raw(94)), // inside the 3 % band: still held
		feed(40, raw(99)),
		feed(50, raw(92), off), // under 93 %
		feed(60, raw(95)),      // not back to 96 yet
		feed(70, raw(96), on),
	})
}

func TestTriggerToeToggle(t *testing.T) {
	e := NewEngine(toeCfg(trigTog))
	runT(t, e, []tstep{
		feed(0, raw(0)),
		feed(10, raw(100), on), // first push: on
		feed(20, raw(50)),      // letting go sends nothing
		feed(30, raw(100), off),
		feed(40, raw(50)),
		feed(50, raw(100), on),
	})
	if !e.ExpTriggers()[0] {
		t.Fatal("a toggled-on toe click should read as engaged")
	}
	e.Exp(0, raw(50), at(60)).Msgs()
	if !e.ExpTriggers()[0] {
		t.Fatal("a toggle stays engaged after the toe comes back")
	}
}

func TestTriggerFollowsCalibrationAndInvert(t *testing.T) {
	// Heel at 50000, toe at 10000 (toe reads lower), inverted by the user: the travel
	// the CC sends runs 127 at the heel to 0 at the toe, and the trigger reads the
	// same travel, so "above 96 %" is right at the heel.
	cfg := toeCfg(trigCC)
	cfg.Exp[0].Min, cfg.Exp[0].Max, cfg.Exp[0].Invert = 50000, 10000, true
	e := NewEngine(cfg)
	runT(t, e, []tstep{
		feed(0, 10000),      // the toe: travel 0 %
		feed(10, 30000),     // 50 %
		feed(20, 49000, on), // 97.5 %
		feed(30, 60000),     // past the heel, clamped: still held
		feed(40, 45000, off),
	})
}

func TestTriggerResetReleases(t *testing.T) {
	e := NewEngine(engageCfg(nil))
	e.Exp(0, raw(50), at(0)).Msgs()
	if got := trig(e.Reset().Msgs()); !reflect.DeepEqual(got, [][]byte{off}) {
		t.Fatalf("Reset() = %s, want the release", describeAll(got))
	}
	if e.ExpTriggers()[0] || e.Pending() {
		t.Fatal("trigger still engaged or pending after Reset")
	}
	if got := e.Reset().Msgs(); len(got) != 0 {
		t.Fatalf("second Reset() = %s", describeAll(got))
	}
	// The next value engages afresh.
	runT(t, e, []tstep{feed(10, raw(50), on)})
}

func TestTriggerResetDuringOffDelay(t *testing.T) {
	e := NewEngine(engageCfg(nil))
	e.Exp(0, raw(50), at(0)).Msgs()
	e.Exp(0, 0, at(10)).Msgs()
	if got := trig(e.Reset().Msgs()); !reflect.DeepEqual(got, [][]byte{off}) {
		t.Fatalf("Reset() = %s, want the release", describeAll(got))
	}
	runT(t, e, []tstep{tickT(1000)})
}

func TestTriggerResetKeepsToggles(t *testing.T) {
	e := NewEngine(toeCfg(trigTog))
	e.Exp(0, raw(100), at(0)).Msgs()
	if got := e.Reset().Msgs(); len(got) != 0 {
		t.Fatalf("Reset() = %s, a toggle has no release", describeAll(got))
	}
	if !e.ExpTriggers()[0] {
		t.Fatal("Reset turned a toggle off")
	}
}

func TestTriggerCableOutReleases(t *testing.T) {
	e := NewEngine(engageCfg(nil))
	e.Exp(0, raw(50), at(0)).Msgs()
	if got := e.ExpRelease(1).Msgs(); len(got) != 0 {
		t.Fatalf("ExpRelease(1) = %s, input 2 holds nothing", describeAll(got))
	}
	if got := e.ExpRelease(0).Msgs(); !reflect.DeepEqual(got, [][]byte{off}) {
		t.Fatalf("ExpRelease(0) = %s, want the release", describeAll(got))
	}
	if got := e.ExpRelease(0).Msgs(); len(got) != 0 {
		t.Fatalf("second ExpRelease(0) = %s", describeAll(got))
	}
	if e.ExpRelease(-1).Msgs() != nil || e.ExpRelease(2).Msgs() != nil {
		t.Fatal("ExpRelease of an input that does not exist sent something")
	}
	// Plugged back in at the same place: the CC is sent again, and the trigger engages.
	got := e.Exp(0, raw(50), at(10)).Msgs()
	if want := [][]byte{on, cc(1, 11, 64)}; !reflect.DeepEqual(got, want) {
		t.Fatalf("after replug: %s, want %s", describeAll(got), describeAll(want))
	}
}

func TestTriggerConfigChangeReleases(t *testing.T) {
	cases := []struct {
		name string
		edit func(c *Config)
		want [][]byte
	}{
		{"mode off", func(c *Config) { c.Exp[0].Trigger.Mode = TriggerOff }, [][]byte{off}},
		{"other action", func(c *Config) { c.Exp[0].Trigger.Action.Number = 110 }, [][]byte{off}},
		{"input disabled", func(c *Config) { c.Exp[0].Enabled = false }, [][]byte{off}},
		{"threshold moved: re-read on the next value", func(c *Config) { c.Exp[0].Trigger.Threshold = 10 }, nil},
		{"colour of a switch", func(c *Config) { c.Switches[0].Colour.R = 1 }, nil},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			cfg := engageCfg(nil)
			e := NewEngine(cfg)
			e.Exp(0, raw(50), at(0)).Msgs()
			c.edit(&cfg)
			if got := trig(e.SetConfig(cfg).Msgs()); !reflect.DeepEqual(got, c.want) {
				t.Fatalf("SetConfig = %s, want %s", describeAll(got), describeAll(c.want))
			}
			if c.want != nil && (e.ExpTriggers()[0] || e.Pending()) {
				t.Fatal("still engaged after the release")
			}
		})
	}
}

func TestTriggerConfigChangeDuringOffDelay(t *testing.T) {
	cfg := engageCfg(nil)
	e := NewEngine(cfg)
	e.Exp(0, raw(50), at(0)).Msgs()
	e.Exp(0, 0, at(10)).Msgs()
	cfg.Exp[0].Trigger.Mode = TriggerToe
	if got := trig(e.SetConfig(cfg).Msgs()); !reflect.DeepEqual(got, [][]byte{off}) {
		t.Fatalf("SetConfig = %s, want the release", describeAll(got))
	}
	runT(t, e, []tstep{tickT(1000)})
}

func TestTriggerReleaseEndsWhatWasPressed(t *testing.T) {
	// The release half is the action that pressed, even after a threshold edit.
	cfg := engageCfg(nil)
	e := NewEngine(cfg)
	e.Exp(0, raw(50), at(0)).Msgs()
	cfg.Exp[0].Trigger.Threshold = 20
	e.SetConfig(cfg).Msgs()
	runT(t, e, []tstep{feed(10, raw(30)), feed(20, raw(10)), tickT(420, off)})
}

func TestTriggerOffSendsOnlyTheCC(t *testing.T) {
	e := NewEngine(Default())
	for i, r := range []int{0, raw(50), raw(100), 0} {
		for _, m := range e.Exp(0, r, at(i*10)).Msgs() {
			if m[1] != 11 {
				t.Fatalf("trigger off sent %s", Describe(m))
			}
		}
	}
	if e.ExpTriggers() != [2]bool{} || e.Pending() {
		t.Fatal("trigger off engaged or pending")
	}
}

func TestTriggerDisabledInputDoesNothing(t *testing.T) {
	cfg := engageCfg(nil)
	cfg.Exp[0].Enabled = false
	e := NewEngine(cfg)
	if got := e.Exp(0, raw(50), at(0)).Msgs(); len(got) != 0 {
		t.Fatalf("disabled input sent %s", describeAll(got))
	}
}

func TestTriggerLowThresholdStillLetsGo(t *testing.T) {
	// At 2 % the band would end below the heel: the heel itself lets go.
	e := NewEngine(engageCfg(func(tr *ExpTrigger) { tr.Threshold, tr.OffDelayMS = 2, 0 }))
	runT(t, e, []tstep{feed(0, raw(3), on), feed(10, raw(0.5)), feed(20, 0, off)})
}

// A threshold is a percent of the value that goes out, so it moves with the curve: on
// Gentle, 50 % (CC 64) is reached about 79 % of the way to the toe, not half way.
func TestTriggerUsesTheCurvedValue(t *testing.T) {
	cfg := cfgWith(func(c *Config) {
		c.Exp[0].Trigger = ExpTrigger{Mode: TriggerToe, Action: trigCC, Threshold: 50}
		c.Exp[0].Curve = ExpCurve{Kind: CurveGentle}
	})
	runT(t, NewEngine(cfg), []tstep{
		feed(0, raw(50)),  // linear would press here
		feed(10, raw(75)), // gentle(0.75) is 0.445
		feed(20, raw(80), cc(1, 102, 127)),
		feed(30, raw(77)),                // 0.475: inside the hysteresis
		feed(40, raw(72), cc(1, 102, 0)), // 0.42: under 47 %, lets go
	})
	// The same thresholds on Fast press far earlier in the travel.
	cfg.Exp[0].Curve = ExpCurve{Kind: CurveFast}
	runT(t, NewEngine(cfg), []tstep{
		feed(0, raw(20)),
		feed(10, raw(25), cc(1, 102, 127)), // fast(0.25) is 0.55
	})
}
