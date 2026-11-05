package bridge

import (
	"bytes"
	"sync"
	"testing"
	"time"

	"flintstep/internal/ble"
	"flintstep/internal/mapping"
	"flintstep/internal/sparkx"
)

type fakePedal struct {
	mu    sync.Mutex
	lamps [][sparkx.Lamps]sparkx.Colour
}

func (p *fakePedal) SetLamps(l [sparkx.Lamps]sparkx.Colour) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.lamps = append(p.lamps, l)
}

func (p *fakePedal) Status() ble.Status { return ble.Status{} }

func (p *fakePedal) last() ([sparkx.Lamps]sparkx.Colour, int) {
	p.mu.Lock()
	defer p.mu.Unlock()
	if len(p.lamps) == 0 {
		return [sparkx.Lamps]sparkx.Colour{}, 0
	}
	return p.lamps[len(p.lamps)-1], len(p.lamps)
}

type fakeOut struct {
	mu   sync.Mutex
	sent [][]byte
}

func (o *fakeOut) Send(m []byte) error {
	o.mu.Lock()
	defer o.mu.Unlock()
	o.sent = append(o.sent, append([]byte(nil), m...))
	return nil
}

func (o *fakeOut) all() [][]byte {
	o.mu.Lock()
	defer o.mu.Unlock()
	return append([][]byte(nil), o.sent...)
}

// clock is the bridge's injected clock. Locked: the tick loop reads it while a test
// moves it on.
type clock struct {
	mu sync.Mutex
	t  time.Time
}

func (c *clock) now() time.Time {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.t
}

func (c *clock) advance(d time.Duration) {
	c.mu.Lock()
	c.t = c.t.Add(d)
	c.mu.Unlock()
}

func setup(t *testing.T, cfg mapping.Config) (*Bridge, *fakePedal, *fakeOut, *clock, *[]Activity) {
	t.Helper()
	c := &clock{t: time.Unix(1_000_000, 0)}
	var acts []Activity
	var mu sync.Mutex
	out := &fakeOut{}
	b := New(cfg, out, Options{Now: c.now, OnActivity: func(a Activity) {
		mu.Lock()
		acts = append(acts, a)
		mu.Unlock()
	}})
	t.Cleanup(b.Close)
	p := &fakePedal{}
	b.SetPedal(p)
	return b, p, out, c, &acts
}

func TestSwitchSendsMIDIAndLightsLamp(t *testing.T) {
	cfg := mapping.Default()
	b, p, out, _, acts := setup(t, cfg)
	h := b.Handlers()

	h.Switch(sparkx.Edge{Switch: 1, Down: true})
	sent := out.all()
	if len(sent) != 1 || !bytes.Equal(sent[0], []byte{0xB0, 81, 127}) {
		t.Fatalf("press II sent % x, want CC 81 = 127 on ch 1", sent)
	}
	lamps, _ := p.last()
	if lamps[1] == (sparkx.Colour{}) {
		t.Errorf("lamp II dark while held in local mode")
	}

	h.Switch(sparkx.Edge{Switch: 1})
	sent = out.all()
	if len(sent) != 2 || !bytes.Equal(sent[1], []byte{0xB0, 81, 0}) {
		t.Fatalf("release II sent % x, want CC 81 = 0", sent)
	}
	lamps, _ = p.last()
	if lamps[1] != (sparkx.Colour{}) {
		t.Errorf("lamp II still lit after release: %+v", lamps[1])
	}
	if len(*acts) != 2 || (*acts)[0].Dir != "out" || (*acts)[0].Label == "" {
		t.Errorf("activity = %+v, want two labelled out entries", *acts)
	}
}

func TestLampsOnlySentWhenChanged(t *testing.T) {
	b, p, _, _, _ := setup(t, mapping.Default())
	h := b.Handlers()
	h.Switch(sparkx.Edge{Switch: 0, Down: true})
	_, n1 := p.last()
	// Expression travel changes no lamp.
	cfg := b.Config()
	h.Exp(0, cfg.Exp[0].Max)
	h.Exp(0, cfg.Exp[0].Min)
	if _, n2 := p.last(); n2 != n1 {
		t.Errorf("SetLamps called %d more times for exp travel", n2-n1)
	}
}

func TestExpSendsCC(t *testing.T) {
	b, _, out, _, _ := setup(t, mapping.Default())
	b.Handlers().Exp(0, 65535)
	sent := out.all()
	if len(sent) != 1 || !bytes.Equal(sent[0], []byte{0xB0, 11, 127}) {
		t.Fatalf("exp 1 at toe sent % x, want CC 11 = 127", sent)
	}
}

func TestLongPressFiresFromTick(t *testing.T) {
	cfg := mapping.Default()
	cfg.Switches[2].Long = mapping.Action{Kind: mapping.KindPC, Channel: 1, Number: 9, Value: 127}
	b, _, out, c, _ := setup(t, cfg)
	b.Handlers().Switch(sparkx.Edge{Switch: 2, Down: true})
	if n := len(out.all()); n != 0 {
		t.Fatalf("a switch with a long press sent %d messages on press", n)
	}
	c.advance(time.Duration(cfg.LongPressMS+20) * time.Millisecond)
	b.Tick()
	sent := out.all()
	if len(sent) != 1 || !bytes.Equal(sent[0], []byte{0xC0, 9}) {
		t.Fatalf("long press sent % x, want program change 9", sent)
	}
}

func TestDisconnectResetsHeldSwitches(t *testing.T) {
	b, p, _, _, _ := setup(t, mapping.Default())
	h := b.Handlers()
	h.Switch(sparkx.Edge{Switch: 3, Down: true})
	h.Status(ble.Status{State: ble.StateSearching})
	h.Status(ble.Status{State: ble.StateConnected})
	lamps, _ := p.last()
	if lamps[3] != (sparkx.Colour{}) {
		t.Errorf("lamp IV lit after a reconnect, though the switch was released with the link")
	}
}

func TestFeedbackModeLightsFromMIDI(t *testing.T) {
	cfg := mapping.Default()
	cfg.LEDMode = mapping.LEDFeedback
	b, p, _, _, acts := setup(t, cfg)
	b.Feedback([]byte{0xB0, 84, 127}) // CC 84 = switch IV
	lamps, _ := p.last()
	if lamps[4] == (sparkx.Colour{}) {
		t.Errorf("lamp IV dark after CC 84 = 127 came back")
	}
	if len(*acts) != 1 || (*acts)[0].Dir != "in" {
		t.Errorf("feedback not logged as incoming: %+v", *acts)
	}
	b.Feedback([]byte{0xB0, 84, 0})
	lamps, _ = p.last()
	if lamps[4] != (sparkx.Colour{}) {
		t.Errorf("lamp IV lit after CC 84 = 0")
	}
}

func TestApplyRefusesInvalidConfig(t *testing.T) {
	b, _, _, _, _ := setup(t, mapping.Default())
	bad := mapping.Default()
	bad.Combos = []mapping.Combo{{A: 1, B: 1, Action: mapping.Action{Kind: mapping.KindCC, Channel: 1, Number: 90, Value: 127}}}
	if _, err := b.Apply(bad); err == nil {
		t.Fatal("Apply took a combo of one switch with itself")
	}
	if len(b.Config().Combos) != 0 {
		t.Error("the refused config replaced the old one")
	}
}

func TestNoOutputStillLogs(t *testing.T) {
	var got []Activity
	b := New(mapping.Default(), nil, Options{OnActivity: func(a Activity) { got = append(got, a) }})
	defer b.Close()
	b.Handlers().Switch(sparkx.Edge{Switch: 0, Down: true})
	if len(got) != 1 {
		t.Fatalf("activity without a MIDI port = %d entries, want 1", len(got))
	}
}

func TestDropReleasesHeldSwitch(t *testing.T) {
	b, _, out, _, _ := setup(t, mapping.Default())
	h := b.Handlers()
	h.Switch(sparkx.Edge{Switch: 5, Down: true})
	h.Status(ble.Status{State: ble.StateSearching})
	sent := out.all()
	if len(sent) != 2 || !bytes.Equal(sent[1], []byte{0xB0, 85, 0}) {
		t.Fatalf("after a drop mid-press sent % x, want CC 85 = 0 last", sent)
	}
}
