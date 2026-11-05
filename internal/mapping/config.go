package mapping

import (
	"fmt"
	"strings"

	"flintstep/internal/sparkx"
)

// THE MAPPING: what each switch and expression input sends.
//
// Config is the JSON the frontend edits and store keeps on disk. It is deliberately
// flat and dumb: every field is something the UI shows. Normalize makes any Config
// safe to run (clamped, zero values filled); Validate catches the mistakes Normalize
// cannot fix by clamping, in words the UI can show as they are.

// ActionKind is what a switch sends.
type ActionKind string

// Action kinds.
const (
	KindOff  ActionKind = "off"
	KindCC   ActionKind = "cc"
	KindNote ActionKind = "note"
	KindPC   ActionKind = "pc"
)

// CCMode is how a CC action reads press and release.
type CCMode string

// CC modes.
const (
	// Momentary sends Value on press and 0 on release.
	Momentary CCMode = "momentary"
	// Toggle alternates Value and 0 on each press; the release sends nothing.
	Toggle CCMode = "toggle"
)

// LEDMode decides what lights a switch lamp.
type LEDMode string

// LED modes.
const (
	// LEDLocal lights a switch while it is held and while its toggle is on.
	LEDLocal LEDMode = "local"
	// LEDFeedback lights a switch from MIDI sent back to the LED destination, so the
	// DAW's state is what shows.
	LEDFeedback LEDMode = "feedback"
)

// ConfigVersion is the Version a Normalized Config carries. 2 added Indicators: a
// version 1 file has none, and Normalize gives it the defaults. 3 added the expression
// triggers: an older file has none, and Normalize gives each input one that is off.
const ConfigVersion = 3

// Ranges and defaults. frontend/src/lib/config.ts mirrors these (LONG_PRESS, RAW_MAX).
const (
	DefaultLongPressMS = 500
	MinLongPressMS     = 150 // shorter and a normal tap reads as a long press
	MaxLongPressMS     = 3000
	DefaultBrightness  = 100
	ExpRawMax          = 65535

	// Expression triggers (ExpTrigger). Thresholds are percent of the calibrated
	// travel. frontend/src/lib/trigger.ts mirrors these.
	MinTriggerThreshold      = 1
	MaxTriggerThreshold      = 99
	DefaultEngageThreshold   = 4  // just off the heel, like an auto-engage wah
	DefaultToeThreshold      = 96 // the last few percent before the toe stop
	TriggerHysteresis        = 3  // percent back past the threshold before it lets go
	DefaultTriggerOffDelayMS = 400
	MaxTriggerOffDelayMS     = 2000
	triggerCCBase            = 102 // exp n's trigger defaults to CC 102+n, undefined in the MIDI spec
)

// Action is one MIDI message pair: a press half and, for momentary CCs and notes, a
// release half.
type Action struct {
	Kind    ActionKind `json:"kind"`
	Channel int        `json:"channel"` // 1..16
	Number  int        `json:"number"`  // CC number, note number or program 0..127
	Value   int        `json:"value"`   // CC "on" value / note velocity, 1..127
	Mode    CCMode     `json:"mode"`    // cc only
}

// SwitchConfig is one footswitch.
type SwitchConfig struct {
	Tap    Action        `json:"tap"`
	Long   Action        `json:"long"`   // Kind "off" = no long press
	Colour sparkx.Colour `json:"colour"` // the lamp colour when lit
}

// Combo is two switches pressed together doing something neither does alone.
type Combo struct {
	A      int    `json:"a"` // switch indexes 0..5, A != B
	B      int    `json:"b"`
	Action Action `json:"action"`
}

// ExpConfig is one expression input.
type ExpConfig struct {
	Enabled bool       `json:"enabled"`
	Channel int        `json:"channel"`
	CC      int        `json:"cc"`
	Min     int        `json:"min"`     // raw value at the heel, 0..65535
	Max     int        `json:"max"`     // raw value at the toe; may be below Min, never equal
	Invert  bool       `json:"invert"`  // the user's own flip, on top of heel=0 toe=127
	Trigger ExpTrigger `json:"trigger"` // a switch faked from the pedal's position
}

// TriggerMode is what makes an expression input's trigger fire.
//
// The Spark Control X reads one analogue value per jack, so a pedal's own toe switch
// has nowhere to go. The trigger fakes one from the position instead.
type TriggerMode string

// Trigger modes.
const (
	// TriggerOff: the input only sends its CC.
	TriggerOff TriggerMode = "off"
	// TriggerEngage is an auto-engage wah: press when the pedal leaves the heel (rises
	// to Threshold), release once it has been back below for OffDelayMS.
	TriggerEngage TriggerMode = "engage"
	// TriggerToe is a toe click: press when the pedal is pushed to Threshold, release
	// when it comes back. With a CC toggle each push flips it.
	TriggerToe TriggerMode = "toe"
)

// ExpTrigger is an expression input's trigger.
type ExpTrigger struct {
	Mode       TriggerMode `json:"mode"`
	Action     Action      `json:"action"`     // press half on engaging, release half on letting go
	Threshold  int         `json:"threshold"`  // percent of the calibrated travel, 1..99
	OffDelayMS int         `json:"offDelayMs"` // engage only: 0..2000 ms back down before it lets go
}

// PedalRef is the remembered pedal. Zero means none: take the first one found.
type PedalRef struct {
	Address string `json:"address"`
	Name    string `json:"name"`
}

// Config is everything the user sets.
type Config struct {
	Version     int                           `json:"version"`
	Pedal       PedalRef                      `json:"pedal"`
	Switches    [sparkx.Switches]SwitchConfig `json:"switches"`
	Combos      []Combo                       `json:"combos"`
	Exp         [sparkx.ExpInputs]ExpConfig   `json:"exp"`
	LEDMode     LEDMode                       `json:"ledMode"`
	LongPressMS int                           `json:"longPressMs"`
	Brightness  int                           `json:"brightness"` // 0..100
	Indicators  [Indicators]Indicator         `json:"indicators"` // Amp, App
}

// defaultColours are saturated on purpose: the pedal's LEDs wash pastel colours out
// to white. Amber on the top-left pair, cyan-blue on the bottom-left pair, magenta and
// violet on the A/B column, each a little different so the six can be told apart.
var defaultColours = [sparkx.Switches]sparkx.Colour{
	{R: 255, G: 150, B: 0}, // I: amber
	{R: 255, G: 80, B: 0},  // II: orange
	{R: 255, G: 0, B: 170}, // A: magenta
	{R: 0, G: 220, B: 255}, // III: cyan
	{R: 0, G: 120, B: 255}, // IV: azure
	{R: 150, G: 0, B: 255}, // B: violet
}

// defaultExpCC is CC 11 (expression) on input 1 and CC 7 (volume) on input 2.
var defaultExpCC = [sparkx.ExpInputs]int{11, 7}

func defaultTap(n int) Action {
	return Action{Kind: KindCC, Channel: 1, Number: 80 + n, Value: 127, Mode: Momentary}
}

func offAction() Action {
	return Action{Kind: KindOff, Channel: 1, Value: 127, Mode: Momentary}
}

func defaultExp(n int) ExpConfig {
	return ExpConfig{Enabled: true, Channel: 1, CC: defaultExpCC[n], Min: 0, Max: ExpRawMax, Trigger: defaultTrigger(n)}
}

// defaultTrigger is off, with what auto-engage would use already filled in: CC 102+n
// momentary on channel 1, 4 %, 400 ms.
func defaultTrigger(n int) ExpTrigger {
	return ExpTrigger{
		Mode:       TriggerOff,
		Action:     Action{Kind: KindCC, Channel: 1, Number: triggerCCBase + n, Value: 127, Mode: Momentary},
		Threshold:  DefaultEngageThreshold,
		OffDelayMS: DefaultTriggerOffDelayMS,
	}
}

func defaultThreshold(m TriggerMode) int {
	if m == TriggerToe {
		return DefaultToeThreshold
	}
	return DefaultEngageThreshold
}

// normalize gives a trigger from before triggers existed (no mode at all) the
// default, and clamps the rest. 0 ms is a real off delay, so it is never "not set".
func (t ExpTrigger) normalize(n int) ExpTrigger {
	if t.Mode == "" {
		return defaultTrigger(n)
	}
	if t.Mode != TriggerEngage && t.Mode != TriggerToe {
		t.Mode = TriggerOff
	}
	if t.Action.Kind == "" {
		t.Action = defaultTrigger(n).Action
	}
	t.Action = t.Action.normalize()
	t.Threshold = clamp(orDefault(t.Threshold, defaultThreshold(t.Mode)), MinTriggerThreshold, MaxTriggerThreshold)
	t.OffDelayMS = clamp(t.OffDelayMS, 0, MaxTriggerOffDelayMS)
	return t
}

// Default is the out-of-the-box mapping: switch n sends CC 80+n momentary on
// channel 1, the expression inputs send CC 11 and CC 7, lamps follow the switches.
func Default() Config {
	c := Config{
		Version:     ConfigVersion,
		Combos:      []Combo{},
		LEDMode:     LEDLocal,
		LongPressMS: DefaultLongPressMS,
		Brightness:  DefaultBrightness,
		Indicators:  defaultIndicators,
	}
	for n := range c.Switches {
		c.Switches[n] = SwitchConfig{Tap: defaultTap(n), Long: offAction(), Colour: defaultColours[n]}
	}
	for n := range c.Exp {
		c.Exp[n] = defaultExp(n)
	}
	return c
}

// Normalize clamps every field into range and fills zero values with defaults, so
// the engine never has to guess. A Version of 0 means the Config did not come from
// this app (a blank struct, a hand-written file): there a zero Brightness or an
// all-zero expression input is "not set" rather than a choice, and gets the default.
//
// Combos are clamped but never dropped: one that names the same switch twice is
// Validate's to report, and the engine ignores it.
func (c Config) Normalize() Config {
	fresh := c.Version == 0
	c.Version = ConfigVersion
	c.Pedal.Address = strings.TrimSpace(c.Pedal.Address)
	c.Pedal.Name = strings.TrimSpace(c.Pedal.Name)

	for n := range c.Switches {
		s := &c.Switches[n]
		if s.Tap.Kind == "" {
			s.Tap = defaultTap(n)
		}
		if s.Long.Kind == "" {
			s.Long = offAction()
		}
		s.Tap = s.Tap.normalize()
		s.Long = s.Long.normalize()
		if s.Colour == (sparkx.Colour{}) {
			// A black lamp is a lamp that never lights: not a colour anyone picks.
			s.Colour = defaultColours[n]
		}
	}

	combos := make([]Combo, 0, len(c.Combos))
	for _, cb := range c.Combos {
		cb.A = clamp(cb.A, 0, sparkx.Switches-1)
		cb.B = clamp(cb.B, 0, sparkx.Switches-1)
		if cb.Action.Kind == "" {
			cb.Action.Kind = KindOff
		}
		cb.Action = cb.Action.normalize()
		combos = append(combos, cb)
	}
	c.Combos = combos

	for n := range c.Exp {
		e := &c.Exp[n]
		if fresh && *e == (ExpConfig{}) {
			*e = defaultExp(n)
		}
		e.Channel = clamp(orDefault(e.Channel, 1), 1, 16)
		e.CC = clamp(e.CC, 0, 127)
		e.Min = clamp(e.Min, 0, ExpRawMax)
		e.Max = clamp(e.Max, 0, ExpRawMax)
		// Min is the heel and Max the toe, whichever reads higher: a pedal whose toe
		// reads lower simply has Min > Max, and the engine handles both ways round.
		if e.Min == 0 && e.Max == 0 {
			e.Max = ExpRawMax
		}
		e.Trigger = e.Trigger.normalize(n)
	}

	if c.LEDMode != LEDLocal && c.LEDMode != LEDFeedback {
		c.LEDMode = LEDLocal
	}
	c.LongPressMS = clamp(orDefault(c.LongPressMS, DefaultLongPressMS), MinLongPressMS, MaxLongPressMS)
	if fresh && c.Brightness == 0 {
		c.Brightness = DefaultBrightness
	}
	c.Brightness = clamp(c.Brightness, 0, 100)

	// A file from before the indicators (version 1) has none: an empty mode and a
	// black colour, which the two rules below turn into the defaults.
	for n := range c.Indicators {
		ind := &c.Indicators[n]
		if !validIndicatorMode(ind.Mode) {
			ind.Mode = defaultIndicators[n].Mode
		}
		if ind.Colour == (sparkx.Colour{}) {
			ind.Colour = defaultIndicators[n].Colour
		}
	}
	return c
}

func (a Action) normalize() Action {
	switch a.Kind {
	case KindOff, KindCC, KindNote, KindPC:
	default:
		a.Kind = KindOff
	}
	a.Channel = clamp(orDefault(a.Channel, 1), 1, 16)
	a.Number = clamp(a.Number, 0, 127)
	a.Value = clamp(orDefault(a.Value, 127), 1, 127)
	if a.Mode != Toggle {
		a.Mode = Momentary
	}
	return a
}

// Validate reports the first thing in c that cannot be run as meant. Out-of-range
// numbers are not errors: Normalize clamps them.
func (c Config) Validate() error {
	seen := map[[2]int]bool{}
	for i, cb := range c.Combos {
		if !validSwitch(cb.A) || !validSwitch(cb.B) {
			return fmt.Errorf("combo %d uses a switch that does not exist", i+1)
		}
		if cb.A == cb.B {
			return fmt.Errorf("combo %s uses the same switch twice", comboName(cb))
		}
		if cb.Action.Kind == KindOff || cb.Action.Kind == "" {
			return fmt.Errorf("combo %s does nothing: pick what it sends", comboName(cb))
		}
		k := pairKey(cb.A, cb.B)
		if seen[k] {
			return fmt.Errorf("two combos use %s", comboName(cb))
		}
		seen[k] = true
	}
	for n, e := range c.Exp {
		if e.Enabled && e.Min == e.Max && e.Min != 0 {
			return fmt.Errorf("expression %d: heel and toe were calibrated at the same point", n+1)
		}
		if tr := e.Trigger; (tr.Mode == TriggerEngage || tr.Mode == TriggerToe) && (tr.Action.Kind == KindOff || tr.Action.Kind == "") {
			return fmt.Errorf("expression %d: the trigger does nothing: pick what it sends", n+1)
		}
	}
	return nil
}

func validSwitch(n int) bool { return n >= 0 && n < sparkx.Switches }

func comboName(cb Combo) string {
	return switchName(cb.A) + " + " + switchName(cb.B)
}

func switchName(n int) string {
	if validSwitch(n) {
		return sparkx.SwitchNames[n]
	}
	return fmt.Sprintf("#%d", n)
}

// pairKey is a combo's two switches in order, so A+B and B+A are the same combo.
func pairKey(a, b int) [2]int {
	if a > b {
		a, b = b, a
	}
	return [2]int{a, b}
}

func clamp(v, lo, hi int) int { return min(max(v, lo), hi) }

func orDefault(v, def int) int {
	if v == 0 {
		return def
	}
	return v
}
