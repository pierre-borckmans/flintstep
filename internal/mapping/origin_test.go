package mapping

import (
	"testing"

	"flintstep/internal/sparkx"
)

func srcs(o Outs) []Origin {
	var s []Origin
	for _, x := range o {
		s = append(s, x.Src)
	}
	return s
}

func wantSrc(t *testing.T, what string, got Outs, want Origin) {
	t.Helper()
	if len(got) == 0 {
		t.Fatalf("%s: nothing sent", what)
	}
	for _, x := range got {
		if x.Src != want {
			t.Fatalf("%s: origins %+v, want all %+v", what, srcs(got), want)
		}
	}
}

func TestOriginTap(t *testing.T) {
	e := NewEngine(cfgWith(func(c *Config) { c.Switches[2].Tap = ccI }))
	want := Origin{Source: SrcSwitch, Index: 2}
	wantSrc(t, "press", e.Switch(sparkx.Edge{Switch: 2, Down: true}, at(0)), want)
	wantSrc(t, "release", e.Switch(sparkx.Edge{Switch: 2}, at(50)), want)
}

func TestOriginLongPress(t *testing.T) {
	e := NewEngine(cfgWith(func(c *Config) { c.Switches[1].Tap, c.Switches[1].Long = ccI, longA }))
	if got := e.Switch(sparkx.Edge{Switch: 1, Down: true}, at(0)); len(got) != 0 {
		t.Fatalf("press sent %v before deciding", got.Msgs())
	}
	want := Origin{Source: SrcLong, Index: 1}
	wantSrc(t, "long", e.Tick(at(e.cfg.LongPressMS)), want)
	wantSrc(t, "long release", e.Switch(sparkx.Edge{Switch: 1}, at(e.cfg.LongPressMS+10)), want)

	// A quick press of the same switch is its tap, sent whole.
	e.Switch(sparkx.Edge{Switch: 1, Down: true}, at(2000))
	wantSrc(t, "short", e.Switch(sparkx.Edge{Switch: 1}, at(2050)), Origin{Source: SrcSwitch, Index: 1})
}

func TestOriginCombo(t *testing.T) {
	e := NewEngine(cfgWith(func(c *Config) {
		c.Combos = []Combo{{A: 0, B: 3, Action: ccI}, {A: 4, B: 2, Action: combo}}
	}))
	e.Switch(sparkx.Edge{Switch: 2, Down: true}, at(0))
	want := Origin{Source: SrcCombo, Index: 1, Pair: [2]int{4, 2}}
	wantSrc(t, "combo", e.Switch(sparkx.Edge{Switch: 4, Down: true}, at(20)), want)
	wantSrc(t, "combo release", e.Switch(sparkx.Edge{Switch: 2}, at(200)), want)
}

func TestOriginExpCC(t *testing.T) {
	e := NewEngine(cfgWith(func(c *Config) { c.Exp[1].Enabled = true }))
	wantSrc(t, "exp", e.Exp(1, ExpRawMax, at(0)), Origin{Source: SrcExp, Index: 1})
}

func TestOriginTriggerEdge(t *testing.T) {
	e := NewEngine(toeCfg(trigCC))
	got := e.Exp(0, raw(100), at(0))
	if len(got) != 2 {
		t.Fatalf("toe sent %d messages, want trigger + CC", len(got))
	}
	if want := (Origin{Source: SrcTrigger, Index: 0}); got[0].Src != want {
		t.Errorf("trigger press origin %+v, want %+v", got[0].Src, want)
	}
	if want := (Origin{Source: SrcExp, Index: 0}); got[1].Src != want {
		t.Errorf("CC origin %+v, want %+v", got[1].Src, want)
	}
	got = e.Exp(0, raw(0), at(100))
	if want := (Origin{Source: SrcTrigger, Index: 0}); len(got) != 2 || got[1].Src != want {
		t.Errorf("trigger release origins %+v, want CC then %+v", srcs(got), want)
	}
}

func TestOriginReleaseOnDrop(t *testing.T) {
	e := NewEngine(cfgWith(func(c *Config) {
		c.Switches[5].Tap = note
		c.Exp[0].Trigger = ExpTrigger{Mode: TriggerToe, Action: trigCC, Threshold: 96}
	}))
	e.Switch(sparkx.Edge{Switch: 5, Down: true}, at(0))
	e.Exp(0, raw(100), at(0))
	got := e.Reset()
	want := []Origin{
		{Source: SrcRelease, Of: SrcSwitch, Index: 5},
		{Source: SrcRelease, Of: SrcTrigger, Index: 0},
	}
	if len(got) != 2 || got[0].Src != want[0] || got[1].Src != want[1] {
		t.Fatalf("reset origins %+v, want %+v", srcs(got), want)
	}

	// A cable coming out is a forced release too.
	e.Exp(0, raw(0), at(100))
	e.Exp(0, raw(100), at(200))
	wantSrc(t, "cable out", e.ExpRelease(0), Origin{Source: SrcRelease, Of: SrcTrigger, Index: 0})
}
