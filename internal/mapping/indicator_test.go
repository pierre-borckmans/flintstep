package mapping

import (
	"encoding/json"
	"strings"
	"testing"

	"flintstep/internal/sparkx"
)

var (
	green  = sparkx.Colour{R: 0x00, G: 0xB0, B: 0x50}
	indigo = sparkx.Colour{R: 0x40, G: 0x20, B: 0xFF}
)

func TestDefaultIndicators(t *testing.T) {
	c := Default()
	want := [Indicators]Indicator{
		{Mode: IndicatorMIDIOut, Colour: green},
		{Mode: IndicatorConnected, Colour: indigo},
	}
	if c.Indicators != want {
		t.Fatalf("indicators %+v, want %+v", c.Indicators, want)
	}
	b, _ := json.Marshal(c)
	for _, key := range []string{`"indicators":[{"mode":"midiOut","colour":{"r":0,"g":176,"b":80}}`, `{"mode":"connected","colour":{"r":64,"g":32,"b":255}}]`} {
		if !strings.Contains(string(b), key) {
			t.Errorf("JSON lacks %s: %s", key, b)
		}
	}
}

func TestNormalizeIndicators(t *testing.T) {
	red := sparkx.Colour{R: 255}
	c := Default()
	c.Indicators[IndicatorAmp] = Indicator{Mode: "blink", Colour: red}
	c.Indicators[IndicatorApp] = Indicator{Mode: IndicatorOff}
	c = c.Normalize()
	if got := c.Indicators[IndicatorAmp]; got != (Indicator{Mode: IndicatorMIDIOut, Colour: red}) {
		t.Errorf("unknown mode: %+v, want the default mode and the colour kept", got)
	}
	if got := c.Indicators[IndicatorApp]; got != (Indicator{Mode: IndicatorOff, Colour: indigo}) {
		t.Errorf("black colour: %+v, want off kept and the default colour", got)
	}
	for _, m := range []IndicatorMode{IndicatorOff, IndicatorConnected, IndicatorMIDIOut, IndicatorMIDIIn, IndicatorUSB, IndicatorOn} {
		c.Indicators[IndicatorAmp].Mode = m
		if got := c.Normalize().Indicators[IndicatorAmp].Mode; got != m {
			t.Errorf("mode %q normalized to %q", m, got)
		}
	}
}

// A config saved before the indicators existed (version 1) has no "indicators": it
// gets the defaults, which are what the app showed then.
func TestOldConfigGetsDefaultIndicators(t *testing.T) {
	old := `{"version":1,"pedal":{"address":"x","name":"SparkX"},"ledMode":"feedback","longPressMs":700,"brightness":40}`
	var c Config
	if err := json.Unmarshal([]byte(old), &c); err != nil {
		t.Fatal(err)
	}
	c = c.Normalize()
	if c.Indicators != Default().Indicators {
		t.Errorf("indicators %+v, want the defaults", c.Indicators)
	}
	if c.Version != ConfigVersion || ConfigVersion != 4 {
		t.Errorf("version %d", c.Version)
	}
	if c.LEDMode != LEDFeedback || c.Brightness != 40 {
		t.Error("the rest of the old config was not kept")
	}
}

func TestIndicatorLamps(t *testing.T) {
	cfg := Default()
	cfg.Brightness = 100
	col := sparkx.Colour{R: 200, G: 100, B: 50}
	all := IndicatorState{Connected: true, Powered: true, Out: true, In: true}
	cases := []struct {
		mode IndicatorMode
		on   IndicatorState // a state that lights it
		off  IndicatorState // one that does not, with everything else on
	}{
		{IndicatorConnected, IndicatorState{Connected: true}, IndicatorState{Powered: true, Out: true, In: true}},
		{IndicatorMIDIOut, IndicatorState{Out: true}, IndicatorState{Connected: true, Powered: true, In: true}},
		{IndicatorMIDIIn, IndicatorState{In: true}, IndicatorState{Connected: true, Powered: true, Out: true}},
		{IndicatorUSB, IndicatorState{Powered: true}, IndicatorState{Connected: true, Out: true, In: true}},
		{IndicatorOn, IndicatorState{}, IndicatorState{}},
		{IndicatorOff, all, all},
	}
	for _, c := range cases {
		cfg.Indicators[IndicatorApp] = Indicator{Mode: c.mode, Colour: col}
		got := IndicatorLamps(cfg, c.on)[IndicatorApp]
		if c.mode == IndicatorOff {
			if got != (sparkx.Colour{}) {
				t.Errorf("off lit: %+v", got)
			}
			continue
		}
		if got != col {
			t.Errorf("%s with %+v: %+v, want lit", c.mode, c.on, got)
		}
		if c.mode == IndicatorOn {
			continue
		}
		if got := IndicatorLamps(cfg, c.off)[IndicatorApp]; got != (sparkx.Colour{}) {
			t.Errorf("%s with %+v: %+v, want dark", c.mode, c.off, got)
		}
	}
	cfg.Brightness = 50
	cfg.Indicators[IndicatorAmp] = Indicator{Mode: IndicatorOn, Colour: col}
	if got := IndicatorLamps(cfg, IndicatorState{})[IndicatorAmp]; got != (sparkx.Colour{R: 100, G: 50, B: 25}) {
		t.Errorf("brightness 50: %+v", got)
	}
}
