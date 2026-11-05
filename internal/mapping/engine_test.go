package mapping

import (
	"reflect"
	"testing"
	"time"

	"flintstep/internal/sparkx"
)

var t0 = time.Date(2026, 1, 1, 12, 0, 0, 0, time.UTC)

func at(ms int) time.Time { return t0.Add(time.Duration(ms) * time.Millisecond) }

// step is one thing that happens to the engine, and what it must send.
type step struct {
	ms   int
	sw   int  // switch index, or -1 for a Tick
	down bool // for a switch
	want [][]byte
}

func dn(ms, sw int, want ...[]byte) step { return step{ms: ms, sw: sw, down: true, want: want} }
func up(ms, sw int, want ...[]byte) step { return step{ms: ms, sw: sw, want: want} }
func tick(ms int, want ...[]byte) step   { return step{ms: ms, sw: -1, want: want} }

func run(t *testing.T, e *Engine, steps []step) {
	t.Helper()
	for i, s := range steps {
		var got [][]byte
		if s.sw < 0 {
			got = e.Tick(at(s.ms))
		} else {
			got = e.Switch(sparkx.Edge{Switch: s.sw, Down: s.down}, at(s.ms))
		}
		if len(got) == 0 && len(s.want) == 0 {
			continue
		}
		if !reflect.DeepEqual(got, s.want) {
			t.Fatalf("step %d (%+v): got %s, want %s", i, s, describeAll(got), describeAll(s.want))
		}
	}
}

func describeAll(msgs [][]byte) string {
	s := "["
	for i, m := range msgs {
		if i > 0 {
			s += ", "
		}
		s += Describe(m)
	}
	return s + "]"
}

func cc(ch, num, v int) []byte  { return ccMsg(ch, num, v) }
func non(ch, num, v int) []byte { return noteOn(ch, num, v) }
func noff(ch, num int) []byte   { return noteOff(ch, num) }
func pc(ch, num int) []byte     { return pcMsg(ch, num) }

// cfgWith is Default with edits.
func cfgWith(edit func(c *Config)) Config {
	c := Default()
	edit(&c)
	return c
}

var (
	ccI   = Action{Kind: KindCC, Channel: 1, Number: 20, Value: 100, Mode: Momentary}
	ccTog = Action{Kind: KindCC, Channel: 2, Number: 30, Value: 127, Mode: Toggle}
	note  = Action{Kind: KindNote, Channel: 3, Number: 60, Value: 90}
	prog  = Action{Kind: KindPC, Channel: 4, Number: 5}
	longA = Action{Kind: KindCC, Channel: 1, Number: 40, Value: 127, Mode: Momentary}
	combo = Action{Kind: KindNote, Channel: 10, Number: 36, Value: 127}
)

func TestEngineSwitches(t *testing.T) {
	cases := []struct {
		name  string
		cfg   Config
		steps []step
	}{
		{"default momentary CC", Default(), []step{
			dn(0, 0, cc(1, 80, 127)),
			up(100, 0, cc(1, 80, 0)),
			dn(200, 5, cc(1, 85, 127)),
			up(300, 5, cc(1, 85, 0)),
		}},
		{"momentary CC with its own value", cfgWith(func(c *Config) { c.Switches[0].Tap = ccI }), []step{
			dn(0, 0, cc(1, 20, 100)),
			up(10, 0, cc(1, 20, 0)),
		}},
		{"toggle CC alternates and ignores releases", cfgWith(func(c *Config) { c.Switches[1].Tap = ccTog }), []step{
			dn(0, 1, cc(2, 30, 127)),
			up(100, 1),
			dn(200, 1, cc(2, 30, 0)),
			up(300, 1),
			dn(400, 1, cc(2, 30, 127)),
		}},
		{"note on and off", cfgWith(func(c *Config) { c.Switches[2].Tap = note }), []step{
			dn(0, 2, non(3, 60, 90)),
			up(50, 2, noff(3, 60)),
		}},
		{"program change on press only", cfgWith(func(c *Config) { c.Switches[3].Tap = prog }), []step{
			dn(0, 3, pc(4, 5)),
			up(50, 3),
		}},
		{"off sends nothing", cfgWith(func(c *Config) { c.Switches[4].Tap = offAction() }), []step{
			dn(0, 4),
			up(50, 4),
		}},
		{"repeated edges are ignored", Default(), []step{
			dn(0, 0, cc(1, 80, 127)),
			dn(10, 0),
			up(20, 0, cc(1, 80, 0)),
			up(30, 0),
		}},
		{"two switches held independently", Default(), []step{
			dn(0, 0, cc(1, 80, 127)),
			dn(10, 3, cc(1, 83, 127)),
			up(20, 0, cc(1, 80, 0)),
			up(30, 3, cc(1, 83, 0)),
		}},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) { run(t, NewEngine(c.cfg), c.steps) })
	}
}

func TestEngineLongPress(t *testing.T) {
	withLong := func(tap Action) Config {
		return cfgWith(func(c *Config) {
			c.Switches[0].Tap = tap
			c.Switches[0].Long = longA
		})
	}
	cases := []struct {
		name  string
		cfg   Config
		steps []step
	}{
		{"tap fires whole on an early release", withLong(ccI), []step{
			dn(0, 0),
			tick(100),
			up(200, 0, cc(1, 20, 100), cc(1, 20, 0)),
			tick(600),
		}},
		{"held to LongPressMS fires Long, release ends it", withLong(ccI), []step{
			dn(0, 0),
			tick(499),
			tick(500, cc(1, 40, 127)),
			tick(510),
			up(900, 0, cc(1, 40, 0)),
		}},
		{"a late Tick still fires once", withLong(ccI), []step{
			dn(0, 0),
			tick(800, cc(1, 40, 127)),
			tick(900),
			up(1000, 0, cc(1, 40, 0)),
		}},
		{"release after the deadline with no Tick in between: long, then its release", withLong(ccI), []step{
			dn(0, 0),
			up(700, 0, cc(1, 40, 127), cc(1, 40, 0)),
		}},
		{"tap note is on then off", withLong(note), []step{
			dn(0, 0),
			up(100, 0, non(3, 60, 90), noff(3, 60)),
		}},
		{"tap toggle flips once per tap", withLong(ccTog), []step{
			dn(0, 0),
			up(100, 0, cc(2, 30, 127)),
			dn(200, 0),
			up(300, 0, cc(2, 30, 0)),
		}},
		{"long toggle has its own state", cfgWith(func(c *Config) {
			c.Switches[0].Long = ccTog
		}), []step{
			dn(0, 0),
			tick(500, cc(2, 30, 127)),
			up(600, 0),
			dn(1000, 0),
			up(1100, 0, cc(1, 80, 127), cc(1, 80, 0)),
			dn(2000, 0),
			tick(2500, cc(2, 30, 0)),
			up(2600, 0),
		}},
		{"LongPressMS is honoured", cfgWith(func(c *Config) {
			c.Switches[0].Long = longA
			c.LongPressMS = 800
		}), []step{
			dn(0, 0),
			tick(500),
			tick(799),
			tick(800, cc(1, 40, 127)),
			up(900, 0, cc(1, 40, 0)),
		}},
		{"other switches act at once while one waits", withLong(ccI), []step{
			dn(0, 0),
			dn(100, 1, cc(1, 81, 127)),
			up(150, 1, cc(1, 81, 0)),
			tick(500, cc(1, 40, 127)),
			up(600, 0, cc(1, 40, 0)),
		}},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) { run(t, NewEngine(c.cfg), c.steps) })
	}
}

func TestEngineCombos(t *testing.T) {
	// I + II is a combo; III has no combo.
	base := func(edit func(c *Config)) Config {
		return cfgWith(func(c *Config) {
			c.Combos = []Combo{{A: 0, B: 1, Action: combo}}
			if edit != nil {
				edit(c)
			}
		})
	}
	cases := []struct {
		name  string
		cfg   Config
		steps []step
	}{
		{"partner inside the window fires the combo, not the switches", base(nil), []step{
			dn(0, 0),
			dn(30, 1, non(10, 36, 127)),
			tick(100),
			up(200, 1, noff(10, 36)),
			up(250, 0),
		}},
		{"first released ends the combo, whichever it is", base(nil), []step{
			dn(0, 1),
			dn(59, 0, non(10, 36, 127)),
			up(100, 1, noff(10, 36)),
			up(120, 0),
		}},
		{"partner at exactly 60 ms is too late", base(nil), []step{
			dn(0, 0),
			dn(60, 1, cc(1, 80, 127)),
			tick(119),
			tick(120, cc(1, 81, 127)),
			up(200, 0, cc(1, 80, 0)),
			up(210, 1, cc(1, 81, 0)),
		}},
		{"window closes on Tick, then the switch acts", base(nil), []step{
			dn(0, 0),
			tick(59),
			tick(60, cc(1, 80, 127)),
			up(100, 0, cc(1, 80, 0)),
		}},
		{"released inside the window: a whole tap", base(nil), []step{
			dn(0, 0),
			up(20, 0, cc(1, 80, 127), cc(1, 80, 0)),
			tick(100),
		}},
		{"switches outside any combo do not wait", base(nil), []step{
			dn(0, 3, cc(1, 83, 127)),
			up(10, 3, cc(1, 83, 0)),
		}},
		{"a non-partner pressed in the window does not combine", base(nil), []step{
			dn(0, 0),
			dn(10, 3, cc(1, 83, 127)),
			tick(60, cc(1, 80, 127)),
			up(70, 3, cc(1, 83, 0)),
			up(80, 0, cc(1, 80, 0)),
		}},
		{"switches go back to normal after a combo", base(nil), []step{
			dn(0, 0),
			dn(10, 1, non(10, 36, 127)),
			up(50, 0, noff(10, 36)),
			up(60, 1),
			dn(100, 0),
			tick(160, cc(1, 80, 127)),
			up(200, 0, cc(1, 80, 0)),
		}},
		{"a switch already acting does not pair with a late partner", base(nil), []step{
			dn(0, 0),
			tick(60, cc(1, 80, 127)),
			dn(100, 1),
			tick(160, cc(1, 81, 127)),
			up(200, 1, cc(1, 81, 0)),
			up(210, 0, cc(1, 80, 0)),
		}},
		{"combo switch with a Long action: window, then long press timed from down", base(func(c *Config) {
			c.Switches[0].Long = longA
		}), []step{
			dn(0, 0),
			tick(60),
			tick(499),
			tick(500, cc(1, 40, 127)),
			up(600, 0, cc(1, 40, 0)),
		}},
		{"combo switch with a Long action, early release: tap", base(func(c *Config) {
			c.Switches[0].Long = longA
		}), []step{
			dn(0, 0),
			tick(60),
			up(200, 0, cc(1, 80, 127), cc(1, 80, 0)),
		}},
		{"combo beats a Long action", base(func(c *Config) {
			c.Switches[0].Long = longA
		}), []step{
			dn(0, 0),
			dn(40, 1, non(10, 36, 127)),
			tick(600),
			up(700, 0, noff(10, 36)),
			up(710, 1),
		}},
		{"toggle combo", base(func(c *Config) { c.Combos[0].Action = ccTog }), []step{
			dn(0, 0),
			dn(10, 1, cc(2, 30, 127)),
			up(50, 0),
			up(50, 1),
			dn(100, 1),
			dn(110, 0, cc(2, 30, 0)),
			up(150, 1),
			up(150, 0),
		}},
		{"three-way: earliest waiting partner wins", base(func(c *Config) {
			c.Combos = append(c.Combos, Combo{A: 2, B: 1, Action: prog})
		}), []step{
			dn(0, 2),
			dn(10, 0),
			dn(20, 1, pc(4, 5)),
			tick(70, cc(1, 80, 127)),
			up(100, 1),
			up(100, 2),
			up(100, 0, cc(1, 80, 0)),
		}},
		{"same-switch and off combos are ignored", cfgWith(func(c *Config) {
			c.Combos = []Combo{{A: 0, B: 0, Action: combo}, {A: 1, B: 2, Action: offAction()}}
		}), []step{
			dn(0, 0, cc(1, 80, 127)),
			dn(10, 1, cc(1, 81, 127)),
			dn(20, 2, cc(1, 82, 127)),
		}},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) { run(t, NewEngine(c.cfg), c.steps) })
	}
}

func TestEnginePending(t *testing.T) {
	e := NewEngine(cfgWith(func(c *Config) {
		c.Combos = []Combo{{A: 0, B: 1, Action: combo}}
		c.Switches[2].Long = longA
	}))
	if e.Pending() {
		t.Fatal("pending before anything happened")
	}
	e.Switch(sparkx.Edge{Switch: 3, Down: true}, at(0))
	if e.Pending() {
		t.Fatal("a plain switch should not leave a timer")
	}
	e.Switch(sparkx.Edge{Switch: 0, Down: true}, at(0))
	if !e.Pending() {
		t.Fatal("combo window should be pending")
	}
	e.Tick(at(60))
	if e.Pending() {
		t.Fatal("combo window should have closed")
	}
	e.Switch(sparkx.Edge{Switch: 2, Down: true}, at(100))
	if !e.Pending() {
		t.Fatal("long press should be pending")
	}
	e.Tick(at(600))
	if e.Pending() {
		t.Fatal("long press should have fired")
	}
}

func TestEngineSetConfigKeepsToggles(t *testing.T) {
	cfg := cfgWith(func(c *Config) {
		c.Switches[0].Tap = ccTog
		c.Switches[1].Long = ccTog
		c.Combos = []Combo{{A: 3, B: 4, Action: ccTog}}
	})
	e := NewEngine(cfg)
	run(t, e, []step{
		dn(0, 0, cc(2, 30, 127)), up(10, 0),
		dn(100, 1), tick(600, cc(2, 30, 127)), up(700, 1),
		dn(1000, 3), dn(1010, 4, cc(2, 30, 127)), up(1050, 3), up(1050, 4),
	})
	lit := func(want ...int) {
		t.Helper()
		l := e.Lamps()
		for n := range l {
			on := l[n] != (sparkx.Colour{})
			exp := false
			for _, w := range want {
				exp = exp || w == n
			}
			if on != exp {
				t.Fatalf("lamp %s lit=%v, want %v (lamps %v)", sparkx.SwitchNames[n], on, exp, l)
			}
		}
	}
	lit(0, 1, 3, 4)

	// A colour edit keeps every toggle.
	cfg.Switches[0].Colour = sparkx.Colour{R: 1}
	e.SetConfig(cfg)
	lit(0, 1, 3, 4)
	// The next press of a kept toggle turns it off.
	run(t, e, []step{dn(2000, 0, cc(2, 30, 0)), up(2010, 0)})
	lit(1, 3, 4)

	// Turning a toggle into something else forgets it.
	cfg.Switches[1].Long = longA
	cfg.Combos[0].Action = combo
	e.SetConfig(cfg)
	lit()

	// And turning it back starts it off.
	cfg.Switches[1].Long = ccTog
	e.SetConfig(cfg)
	lit()
}

func TestEngineReleaseEndsWhatThePressSent(t *testing.T) {
	e := NewEngine(cfgWith(func(c *Config) { c.Switches[0].Tap = note }))
	run(t, e, []step{dn(0, 0, non(3, 60, 90))})
	e.SetConfig(Default())
	run(t, e, []step{up(100, 0, noff(3, 60)), dn(200, 0, cc(1, 80, 127))})
}

func TestEngineSetConfigMidCombo(t *testing.T) {
	e := NewEngine(cfgWith(func(c *Config) { c.Combos = []Combo{{A: 0, B: 1, Action: combo}} }))
	run(t, e, []step{dn(0, 0), dn(10, 1, non(10, 36, 127))})
	e.SetConfig(Default())
	run(t, e, []step{up(50, 1, noff(10, 36)), up(60, 0)})
}

func TestEngineReset(t *testing.T) {
	e := NewEngine(cfgWith(func(c *Config) {
		c.Switches[1].Tap = ccTog
		c.Switches[2].Long = longA
	}))
	run(t, e, []step{
		dn(0, 1, cc(2, 30, 127)), up(10, 1),
		dn(100, 0, cc(1, 80, 127)),
		dn(100, 2),
	})
	e.Reset()
	if e.Pending() {
		t.Fatal("Reset left a timer")
	}
	l := e.Lamps()
	if l[0] != (sparkx.Colour{}) || l[2] != (sparkx.Colour{}) {
		t.Fatalf("held lamps still lit after Reset: %v", l)
	}
	if l[1] == (sparkx.Colour{}) {
		t.Fatal("Reset turned a toggle off")
	}
	// The pedal comes back with nothing held: stale releases are nothing, presses work.
	run(t, e, []step{
		tick(1000),
		up(1000, 0),
		up(1000, 2),
		dn(1100, 1, cc(2, 30, 0)),
		dn(1100, 0, cc(1, 80, 127)),
	})
}

func TestEngineLocalLamps(t *testing.T) {
	e := NewEngine(Default())
	if e.Lamps() != ([6]sparkx.Colour{}) {
		t.Fatal("lamps lit with nothing held")
	}
	e.Switch(sparkx.Edge{Switch: 2, Down: true}, at(0))
	if got, want := e.Lamps()[2], defaultColours[2]; got != want {
		t.Fatalf("held lamp = %v, want %v", got, want)
	}
	e.Switch(sparkx.Edge{Switch: 2}, at(10))
	if e.Lamps()[2] != (sparkx.Colour{}) {
		t.Fatal("lamp still lit after release")
	}
	// A switch still waiting on a combo or long press is held, so it is lit.
	e.SetConfig(cfgWith(func(c *Config) { c.Switches[0].Long = longA }))
	e.Switch(sparkx.Edge{Switch: 0, Down: true}, at(100))
	if e.Lamps()[0] == (sparkx.Colour{}) {
		t.Fatal("waiting switch not lit")
	}
	// Local mode ignores feedback.
	if e.Feedback(cc(1, 81, 127)) {
		t.Fatal("feedback changed lamps in local mode")
	}
}

func TestEngineBrightness(t *testing.T) {
	cases := []struct {
		pct  int
		in   sparkx.Colour
		want sparkx.Colour
	}{
		{100, sparkx.Colour{R: 255, G: 150, B: 1}, sparkx.Colour{R: 255, G: 150, B: 1}},
		{50, sparkx.Colour{R: 255, G: 150, B: 1}, sparkx.Colour{R: 128, G: 75, B: 1}},
		{10, sparkx.Colour{R: 255, G: 4, B: 200}, sparkx.Colour{R: 26, G: 0, B: 20}},
		{0, sparkx.Colour{R: 255, G: 255, B: 255}, sparkx.Colour{}},
	}
	for _, c := range cases {
		e := NewEngine(cfgWith(func(cfg *Config) {
			cfg.Brightness = c.pct
			cfg.Switches[0].Colour = c.in
		}))
		e.Switch(sparkx.Edge{Switch: 0, Down: true}, at(0))
		if got := e.Lamps()[0]; got != c.want {
			t.Errorf("brightness %d: %v -> %v, want %v", c.pct, c.in, got, c.want)
		}
	}
}

func TestEngineFeedback(t *testing.T) {
	e := NewEngine(cfgWith(func(c *Config) {
		c.LEDMode = LEDFeedback
		c.Switches[1].Tap = note // ch 3 note 60
		c.Switches[2].Tap = prog // ch 4 program 5
		c.Switches[3].Tap = ccTog
	}))
	cases := []struct {
		name    string
		msg     []byte
		changed bool
		lit     [6]bool
	}{
		{"CC on lights its switch", cc(1, 80, 127), true, [6]bool{true}},
		{"same again changes nothing", cc(1, 80, 64), false, [6]bool{true}},
		{"other channel is someone else", cc(2, 80, 0), false, [6]bool{true}},
		{"CC 0 puts it out", cc(1, 80, 0), true, [6]bool{}},
		{"note on", non(3, 60, 100), true, [6]bool{false, true}},
		{"note on velocity 0 is off", non(3, 60, 0), true, [6]bool{}},
		{"note on again", non(3, 60, 1), true, [6]bool{false, true}},
		{"note off", []byte{0x82, 60, 64}, true, [6]bool{}},
		{"a CC with the note's number is not the note", cc(3, 60, 127), false, [6]bool{}},
		{"program changes never light", pc(4, 5), false, [6]bool{}},
		{"CC 5 on ch 4 is not the PC switch", cc(4, 5, 127), false, [6]bool{}},
		{"toggle switch lights from feedback", cc(2, 30, 127), true, [6]bool{false, false, false, true}},
		{"short message", []byte{0xB0, 80}, false, [6]bool{false, false, false, true}},
		{"empty", nil, false, [6]bool{false, false, false, true}},
	}
	for _, c := range cases {
		if got := e.Feedback(c.msg); got != c.changed {
			t.Fatalf("%s: Feedback = %v, want %v", c.name, got, c.changed)
		}
		l := e.Lamps()
		for n := range l {
			if (l[n] != sparkx.Colour{}) != c.lit[n] {
				t.Fatalf("%s: lamps %v, want lit %v", c.name, l, c.lit)
			}
		}
	}

	// Pressing does not light a switch in feedback mode: the DAW decides.
	e.Switch(sparkx.Edge{Switch: 0, Down: true}, at(0))
	if e.Lamps()[0] != (sparkx.Colour{}) {
		t.Fatal("held switch lit in feedback mode")
	}
}

func TestEngineFeedbackRecordedInLocalMode(t *testing.T) {
	cfg := Default()
	e := NewEngine(cfg)
	e.Feedback(cc(1, 84, 127))
	cfg.LEDMode = LEDFeedback
	e.SetConfig(cfg)
	if e.Lamps()[4] == (sparkx.Colour{}) {
		t.Fatal("feedback received in local mode not shown after switching modes")
	}
}

func TestEngineExp(t *testing.T) {
	type feed struct {
		raw  int
		want int // -1 = nothing sent
	}
	cases := []struct {
		name  string
		n     int
		exp   ExpConfig
		feeds []feed
	}{
		{"default full range, CC 11", 0, defaultExp(0), []feed{
			{0, 0}, {0, -1}, {65535, 127}, {32768, 64},
		}},
		{"input 2 is CC 7", 1, defaultExp(1), []feed{{65535, 127}}},
		{"inverted", 0, ExpConfig{Enabled: true, Channel: 1, CC: 11, Max: 65535, Invert: true}, []feed{
			{0, 127}, {65535, 0},
		}},
		{"calibrated travel stretches to 0..127", 0, ExpConfig{Enabled: true, Channel: 2, CC: 4, Min: 10000, Max: 20000}, []feed{
			{5000, 0}, {10000, -1}, {15000, 64}, {20000, 127}, {60000, -1},
		}},
		{"calibrated and inverted", 0, ExpConfig{Enabled: true, Channel: 1, CC: 11, Min: 10000, Max: 20000, Invert: true}, []feed{
			{10000, 127}, {20000, 0},
		}},
		{"toe reads lower than heel: heel is still 0, toe 127", 0, ExpConfig{Enabled: true, Channel: 1, CC: 11, Min: 50000, Max: 3000}, []feed{
			{50000, 0}, {60000, -1}, {26500, 64}, {3000, 127}, {0, -1},
		}},
		{"toe lower than heel, inverted by the user", 0, ExpConfig{Enabled: true, Channel: 1, CC: 11, Min: 50000, Max: 3000, Invert: true}, []feed{
			{50000, 127}, {3000, 0},
		}},
		{"hysteresis holds a value against noise", 0, defaultExp(0), []feed{
			// one step is ~516 raw; a value only moves once clearly in the next step.
			{32768, 64}, {33000, -1}, {32700, -1}, {33350, -1}, {33500, 65}, {33200, -1}, {32900, 64},
		}},
		{"disabled sends nothing", 0, ExpConfig{Channel: 1, CC: 11, Max: 65535}, []feed{{0, -1}, {65535, -1}}},
		{"no input 3", 2, defaultExp(0), []feed{{0, -1}}},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			e := NewEngine(cfgWith(func(cfg *Config) {
				if c.n >= 0 && c.n < len(cfg.Exp) {
					cfg.Exp[c.n] = c.exp
				}
			}))
			for _, f := range c.feeds {
				msg, ok := expOne(e, c.n, f.raw)
				if f.want < 0 {
					if ok {
						t.Fatalf("raw %d: sent %s, want nothing", f.raw, Describe(msg))
					}
					continue
				}
				x := c.exp
				if want := cc(x.Channel, x.CC, f.want); !ok || !reflect.DeepEqual(msg, want) {
					t.Fatalf("raw %d: got %s (%v), want %s", f.raw, Describe(msg), ok, Describe(want))
				}
			}
		})
	}
}

func TestEngineExpResends(t *testing.T) {
	cfg := Default()
	e := NewEngine(cfg)
	if _, ok := expOne(e, 0, 0); !ok {
		t.Fatal("first value not sent")
	}
	// Unchanged config: still deduplicated.
	e.SetConfig(cfg)
	if _, ok := expOne(e, 0, 0); ok {
		t.Fatal("repeat sent")
	}
	// New CC: the controller has never heard it, so send.
	cfg.Exp[0].CC = 1
	e.SetConfig(cfg)
	if msg, ok := expOne(e, 0, 0); !ok || !reflect.DeepEqual(msg, cc(1, 1, 0)) {
		t.Fatalf("after CC change: %s %v", Describe(msg), ok)
	}
	// A reconnect resends too.
	e.Reset()
	if _, ok := expOne(e, 0, 0); !ok {
		t.Fatal("not resent after Reset")
	}
}

// expOne feeds one value to an input whose trigger is off and returns the CC it sent,
// if any.
func expOne(e *Engine, n, raw int) ([]byte, bool) {
	out := e.Exp(n, raw, at(0))
	if len(out) == 0 {
		return nil, false
	}
	return out[0], true
}

func TestEngineIgnoresUnknownSwitch(t *testing.T) {
	e := NewEngine(Default())
	for _, n := range []int{-1, 6, 99} {
		if got := e.Switch(sparkx.Edge{Switch: n, Down: true}, at(0)); got != nil {
			t.Errorf("switch %d sent %v", n, got)
		}
	}
}

func TestNewEngineNormalizes(t *testing.T) {
	// A blank config must not panic or send channel-0 garbage.
	e := NewEngine(Config{})
	got := e.Switch(sparkx.Edge{Switch: 0, Down: true}, at(0))
	if !reflect.DeepEqual(got, [][]byte{cc(1, 80, 127)}) {
		t.Fatalf("blank config sent %s", describeAll(got))
	}
}

func TestResetReleasesWhatIsSounding(t *testing.T) {
	cfg := Default()
	cfg.Switches[1].Tap = Action{Kind: KindNote, Channel: 2, Number: 60, Value: 100}
	cfg.Switches[2].Tap = Action{Kind: KindCC, Channel: 1, Number: 82, Value: 127, Mode: Toggle}
	e := NewEngine(cfg)
	at := time.Unix(0, 0)
	e.Switch(sparkx.Edge{Switch: 0, Down: true}, at) // momentary CC 80
	e.Switch(sparkx.Edge{Switch: 1, Down: true}, at) // note on
	e.Switch(sparkx.Edge{Switch: 2, Down: true}, at) // toggle: stays on, nothing to release
	got := e.Reset()
	want := [][]byte{{0xB0, 80, 0}, {0x81, 60, 0}}
	if len(got) != len(want) {
		t.Fatalf("Reset() = % x, want % x", got, want)
	}
	for i := range want {
		if string(got[i]) != string(want[i]) {
			t.Errorf("Reset()[%d] = % x, want % x", i, got[i], want[i])
		}
	}
	if again := e.Reset(); len(again) != 0 {
		t.Errorf("second Reset() = % x, want nothing", again)
	}
}
