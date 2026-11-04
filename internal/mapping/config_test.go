package mapping

import (
	"encoding/json"
	"reflect"
	"strings"
	"testing"

	"sparkbridge/internal/sparkx"
)

func TestDefault(t *testing.T) {
	c := Default()
	if c.Version != ConfigVersion || c.LEDMode != LEDLocal || c.LongPressMS != 500 || c.Brightness != 100 {
		t.Fatalf("Default header wrong: %+v", c)
	}
	if c.Combos == nil || len(c.Combos) != 0 {
		t.Fatal("Default combos should be an empty list, not null in JSON")
	}
	colours := map[sparkx.Colour]bool{}
	for n, s := range c.Switches {
		want := Action{Kind: KindCC, Channel: 1, Number: 80 + n, Value: 127, Mode: Momentary}
		if s.Tap != want {
			t.Errorf("switch %s tap = %+v, want %+v", sparkx.SwitchNames[n], s.Tap, want)
		}
		if s.Long.Kind != KindOff {
			t.Errorf("switch %s has a long press by default", sparkx.SwitchNames[n])
		}
		if s.Colour == (sparkx.Colour{}) || colours[s.Colour] {
			t.Errorf("switch %s colour %v is black or repeated", sparkx.SwitchNames[n], s.Colour)
		}
		colours[s.Colour] = true
	}
	for n, wantCC := range []int{11, 7} {
		want := ExpConfig{Enabled: true, Channel: 1, CC: wantCC, Min: 0, Max: 65535}
		if c.Exp[n] != want {
			t.Errorf("exp %d = %+v, want %+v", n+1, c.Exp[n], want)
		}
	}
	if err := c.Validate(); err != nil {
		t.Fatalf("Default does not validate: %v", err)
	}
	if !reflect.DeepEqual(c.Normalize(), c) {
		t.Fatal("Default is not already normal")
	}
}

func TestNormalizeBlankIsDefault(t *testing.T) {
	if got := (Config{}).Normalize(); !reflect.DeepEqual(got, Default()) {
		t.Fatalf("blank config normalizes to\n%+v\nwant\n%+v", got, Default())
	}
}

func TestNormalize(t *testing.T) {
	cases := []struct {
		name  string
		edit  func(c *Config)
		check func(t *testing.T, c Config)
	}{
		{"action fields clamped", func(c *Config) {
			c.Switches[0].Tap = Action{Kind: KindCC, Channel: 40, Number: 200, Value: 300, Mode: "weird"}
		}, func(t *testing.T, c Config) {
			want := Action{Kind: KindCC, Channel: 16, Number: 127, Value: 127, Mode: Momentary}
			if c.Switches[0].Tap != want {
				t.Fatalf("got %+v", c.Switches[0].Tap)
			}
		}},
		{"negative values clamped", func(c *Config) {
			c.Switches[0].Tap = Action{Kind: KindNote, Channel: -3, Number: -1, Value: -5, Mode: Toggle}
		}, func(t *testing.T, c Config) {
			want := Action{Kind: KindNote, Channel: 1, Number: 0, Value: 1, Mode: Toggle}
			if c.Switches[0].Tap != want {
				t.Fatalf("got %+v", c.Switches[0].Tap)
			}
		}},
		{"zero channel and value filled", func(c *Config) {
			c.Switches[1].Tap = Action{Kind: KindPC, Number: 3}
		}, func(t *testing.T, c Config) {
			if a := c.Switches[1].Tap; a.Channel != 1 || a.Value != 127 || a.Mode != Momentary {
				t.Fatalf("got %+v", a)
			}
		}},
		{"unknown kind is off", func(c *Config) {
			c.Switches[2].Tap.Kind = "sysex"
			c.Switches[2].Long.Kind = ""
		}, func(t *testing.T, c Config) {
			if c.Switches[2].Tap.Kind != KindOff || c.Switches[2].Long.Kind != KindOff {
				t.Fatalf("got %+v", c.Switches[2])
			}
		}},
		{"missing tap gets the switch's default", func(c *Config) {
			c.Switches[3].Tap = Action{}
		}, func(t *testing.T, c Config) {
			if c.Switches[3].Tap != defaultTap(3) {
				t.Fatalf("got %+v", c.Switches[3].Tap)
			}
		}},
		{"black lamp gets the default colour", func(c *Config) {
			c.Switches[4].Colour = sparkx.Colour{}
		}, func(t *testing.T, c Config) {
			if c.Switches[4].Colour != defaultColours[4] {
				t.Fatalf("got %v", c.Switches[4].Colour)
			}
		}},
		{"long press clamped and filled", func(c *Config) { c.LongPressMS = 10 }, func(t *testing.T, c Config) {
			if c.LongPressMS != MinLongPressMS {
				t.Fatalf("got %d", c.LongPressMS)
			}
		}},
		{"long press zero is default", func(c *Config) { c.LongPressMS = 0 }, func(t *testing.T, c Config) {
			if c.LongPressMS != 500 {
				t.Fatalf("got %d", c.LongPressMS)
			}
		}},
		{"long press too long", func(c *Config) { c.LongPressMS = 99999 }, func(t *testing.T, c Config) {
			if c.LongPressMS != MaxLongPressMS {
				t.Fatalf("got %d", c.LongPressMS)
			}
		}},
		{"brightness 0 is a choice once versioned", func(c *Config) { c.Brightness = 0 }, func(t *testing.T, c Config) {
			if c.Brightness != 0 {
				t.Fatalf("got %d", c.Brightness)
			}
		}},
		{"brightness 0 without a version is unset", func(c *Config) { c.Version, c.Brightness = 0, 0 }, func(t *testing.T, c Config) {
			if c.Brightness != 100 {
				t.Fatalf("got %d", c.Brightness)
			}
		}},
		{"brightness clamped", func(c *Config) { c.Brightness = 250 }, func(t *testing.T, c Config) {
			if c.Brightness != 100 {
				t.Fatalf("got %d", c.Brightness)
			}
		}},
		{"unknown LED mode is local", func(c *Config) { c.LEDMode = "disco" }, func(t *testing.T, c Config) {
			if c.LEDMode != LEDLocal {
				t.Fatalf("got %q", c.LEDMode)
			}
		}},
		{"feedback mode kept", func(c *Config) { c.LEDMode = LEDFeedback }, func(t *testing.T, c Config) {
			if c.LEDMode != LEDFeedback {
				t.Fatalf("got %q", c.LEDMode)
			}
		}},
		{"exp clamped", func(c *Config) {
			c.Exp[0] = ExpConfig{Enabled: true, Channel: 0, CC: 300, Min: -5, Max: 99999}
		}, func(t *testing.T, c Config) {
			want := ExpConfig{Enabled: true, Channel: 1, CC: 127, Min: 0, Max: 65535}
			if c.Exp[0] != want {
				t.Fatalf("got %+v", c.Exp[0])
			}
		}},
		{"exp uncalibrated is full range", func(c *Config) { c.Exp[1].Min, c.Exp[1].Max = 0, 0 }, func(t *testing.T, c Config) {
			if c.Exp[1].Min != 0 || c.Exp[1].Max != 65535 {
				t.Fatalf("got %+v", c.Exp[1])
			}
		}},
		{"exp toe below heel is kept as calibrated", func(c *Config) {
			c.Exp[0].Min, c.Exp[0].Max = 50000, 3000
		}, func(t *testing.T, c Config) {
			// Min is the heel and Max the toe, whichever reads higher.
			if e := c.Exp[0]; e.Min != 50000 || e.Max != 3000 || e.Invert {
				t.Fatalf("got %+v", e)
			}
		}},
		{"exp invert is left alone", func(c *Config) {
			c.Exp[1].Min, c.Exp[1].Max, c.Exp[1].Invert = 40000, 1000, true
		}, func(t *testing.T, c Config) {
			if e := c.Exp[1]; e.Min != 40000 || e.Max != 1000 || !e.Invert {
				t.Fatalf("got %+v", e)
			}
		}},
		{"exp disabled stays disabled once versioned", func(c *Config) { c.Exp[0] = ExpConfig{} }, func(t *testing.T, c Config) {
			if c.Exp[0].Enabled {
				t.Fatalf("got %+v", c.Exp[0])
			}
		}},
		{"combos kept, indexes clamped, actions normalized", func(c *Config) {
			c.Combos = []Combo{{A: -1, B: 9, Action: Action{Kind: KindCC, Channel: 0, Number: 1}}, {A: 2, B: 2}}
		}, func(t *testing.T, c Config) {
			if len(c.Combos) != 2 {
				t.Fatalf("got %+v", c.Combos)
			}
			if cb := c.Combos[0]; cb.A != 0 || cb.B != 5 || cb.Action.Channel != 1 || cb.Action.Value != 127 {
				t.Fatalf("got %+v", cb)
			}
			if c.Combos[1].Action.Kind != KindOff {
				t.Fatalf("got %+v", c.Combos[1])
			}
		}},
		{"nil combos become empty", func(c *Config) { c.Combos = nil }, func(t *testing.T, c Config) {
			if c.Combos == nil {
				t.Fatal("nil")
			}
		}},
		{"pedal ref trimmed", func(c *Config) { c.Pedal = PedalRef{Address: " abc ", Name: "SparkX \n"} }, func(t *testing.T, c Config) {
			if c.Pedal != (PedalRef{Address: "abc", Name: "SparkX"}) {
				t.Fatalf("got %+v", c.Pedal)
			}
		}},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			cfg := Default()
			c.edit(&cfg)
			got := cfg.Normalize()
			c.check(t, got)
			if again := got.Normalize(); !reflect.DeepEqual(again, got) {
				t.Fatalf("Normalize is not idempotent:\n%+v\n%+v", got, again)
			}
		})
	}
}

func TestValidate(t *testing.T) {
	cases := []struct {
		name string
		edit func(c *Config)
		want string // substring; "" = valid
	}{
		{"default", func(*Config) {}, ""},
		{"a good combo", func(c *Config) { c.Combos = []Combo{{A: 0, B: 1, Action: defaultTap(0)}} }, ""},
		{"same switch twice", func(c *Config) { c.Combos = []Combo{{A: 2, B: 2, Action: defaultTap(0)}} }, "combo A + A uses the same switch twice"},
		{"switch out of range", func(c *Config) { c.Combos = []Combo{{A: 0, B: 6, Action: defaultTap(0)}} }, "combo 1 uses a switch that does not exist"},
		{"combo that does nothing", func(c *Config) { c.Combos = []Combo{{A: 0, B: 3, Action: offAction()}} }, "combo I + III does nothing"},
		{"duplicate combo either way round", func(c *Config) {
			c.Combos = []Combo{{A: 0, B: 1, Action: defaultTap(0)}, {A: 1, B: 0, Action: defaultTap(1)}}
		}, "two combos use II + I"},
		{"exp calibrated at one point", func(c *Config) { c.Exp[1].Min, c.Exp[1].Max = 3000, 3000 }, "expression 2"},
		{"exp toe below heel is fine", func(c *Config) { c.Exp[0].Min, c.Exp[0].Max = 50000, 3000 }, ""},
		{"exp at one point but disabled is fine", func(c *Config) {
			c.Exp[1] = ExpConfig{Min: 3000, Max: 3000}
		}, ""},
	}
	for _, c := range cases {
		cfg := Default()
		c.edit(&cfg)
		err := cfg.Validate()
		switch {
		case c.want == "" && err != nil:
			t.Errorf("%s: unexpected error %v", c.name, err)
		case c.want != "" && (err == nil || !strings.Contains(err.Error(), c.want)):
			t.Errorf("%s: error %v, want %q", c.name, err, c.want)
		}
	}
}

func TestConfigJSON(t *testing.T) {
	c := Default()
	c.Combos = []Combo{{A: 0, B: 1, Action: defaultTap(2)}}
	b, err := json.Marshal(c)
	if err != nil {
		t.Fatal(err)
	}
	for _, key := range []string{`"version"`, `"pedal"`, `"switches"`, `"tap"`, `"long"`, `"colour"`, `"combos"`,
		`"a":0`, `"b":1`, `"action"`, `"exp"`, `"enabled"`, `"cc"`, `"min"`, `"max"`, `"invert"`,
		`"ledMode":"local"`, `"longPressMs":500`, `"brightness":100`, `"kind":"cc"`, `"mode":"momentary"`} {
		if !strings.Contains(string(b), key) {
			t.Errorf("JSON lacks %s: %s", key, b)
		}
	}
	var back Config
	if err := json.Unmarshal(b, &back); err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(back, c) {
		t.Fatalf("round trip changed the config:\n%+v\n%+v", back, c)
	}
}
