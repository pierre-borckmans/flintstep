package mapping

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestNormalizeTrigger(t *testing.T) {
	cases := []struct {
		name string
		in   ExpTrigger
		want ExpTrigger
	}{
		{"missing (an older file) is the default, off", ExpTrigger{}, defaultTrigger(0)},
		{"unknown mode is off", ExpTrigger{Mode: "wah", Action: trigCC, Threshold: 50, OffDelayMS: 10},
			ExpTrigger{Mode: TriggerOff, Action: trigCC, Threshold: 50, OffDelayMS: 10}},
		{"threshold and delay clamped", ExpTrigger{Mode: TriggerEngage, Action: trigCC, Threshold: 150, OffDelayMS: 9000},
			ExpTrigger{Mode: TriggerEngage, Action: trigCC, Threshold: 99, OffDelayMS: 2000}},
		{"negative threshold and delay", ExpTrigger{Mode: TriggerEngage, Action: trigCC, Threshold: -3, OffDelayMS: -1},
			ExpTrigger{Mode: TriggerEngage, Action: trigCC, Threshold: 1, OffDelayMS: 0}},
		{"no threshold: the mode's default", ExpTrigger{Mode: TriggerToe, Action: trigTog},
			ExpTrigger{Mode: TriggerToe, Action: trigTog, Threshold: 96}},
		{"no action: CC 102", ExpTrigger{Mode: TriggerEngage, Threshold: 4, OffDelayMS: 400}, defaultTriggerAs(TriggerEngage)},
		{"action clamped", ExpTrigger{Mode: TriggerToe, Action: Action{Kind: KindCC, Channel: 40, Number: 200, Value: 0}, Threshold: 96},
			ExpTrigger{Mode: TriggerToe, Action: Action{Kind: KindCC, Channel: 16, Number: 127, Value: 127, Mode: Momentary}, Threshold: 96}},
	}
	for _, c := range cases {
		cfg := Default()
		cfg.Exp[0].Trigger = c.in
		if got := cfg.Normalize().Exp[0].Trigger; got != c.want {
			t.Errorf("%s: got %+v, want %+v", c.name, got, c.want)
		}
	}
}

func defaultTriggerAs(m TriggerMode) ExpTrigger {
	tr := defaultTrigger(0)
	tr.Mode = m
	return tr
}

// A version 2 file has no "trigger" on its inputs: each gets one that is off, and the
// rest of the input is kept.
func TestOldConfigGetsTriggersOff(t *testing.T) {
	old := `{"version":2,"exp":[{"enabled":true,"channel":3,"cc":4,"min":100,"max":60000,"invert":true},{"enabled":false,"channel":1,"cc":7,"min":0,"max":65535}]}`
	var c Config
	if err := json.Unmarshal([]byte(old), &c); err != nil {
		t.Fatal(err)
	}
	c = c.Normalize()
	for n := range c.Exp {
		if c.Exp[n].Trigger != defaultTrigger(n) {
			t.Errorf("exp %d trigger %+v, want %+v", n+1, c.Exp[n].Trigger, defaultTrigger(n))
		}
	}
	if x := c.Exp[0]; x.Channel != 3 || x.CC != 4 || x.Min != 100 || x.Max != 60000 || !x.Invert {
		t.Errorf("exp 1 not kept: %+v", x)
	}
	if err := c.Validate(); err != nil {
		t.Fatal(err)
	}
}

func TestValidateTrigger(t *testing.T) {
	cfg := Default()
	cfg.Exp[1].Trigger = ExpTrigger{Mode: TriggerToe, Action: offAction(), Threshold: 96}
	err := cfg.Validate()
	if err == nil || err.Error() != "expression 2: the trigger does nothing: pick what it sends" {
		t.Fatalf("err = %v", err)
	}
	cfg.Exp[1].Trigger.Mode = TriggerOff
	if err := cfg.Validate(); err != nil {
		t.Fatalf("an off trigger with an off action: %v", err)
	}
}

func TestTriggerJSON(t *testing.T) {
	b, err := json.Marshal(Default().Exp[0])
	if err != nil {
		t.Fatal(err)
	}
	want := `"trigger":{"mode":"off","action":{"kind":"cc","channel":1,"number":102,"value":127,"mode":"momentary"},"threshold":4,"offDelayMs":400}`
	if !strings.Contains(string(b), want) {
		t.Fatalf("JSON %s lacks %s", b, want)
	}
}
