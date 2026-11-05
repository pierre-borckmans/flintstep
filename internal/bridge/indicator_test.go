package bridge

import (
	"testing"
	"time"

	"flintstep/internal/ble"
	"flintstep/internal/mapping"
	"flintstep/internal/sparkx"
)

func connected(powered bool) ble.Status {
	st := ble.Status{State: ble.StateConnected}
	st.Powered = powered
	return st
}

func indicatorCfg(amp, app mapping.IndicatorMode) mapping.Config {
	cfg := mapping.Default()
	cfg.Indicators[mapping.IndicatorAmp].Mode = amp
	cfg.Indicators[mapping.IndicatorApp].Mode = app
	return cfg
}

func lamp(p *fakePedal, n int) sparkx.Colour {
	l, _ := p.last()
	return l[n]
}

// calls counts SetLamps calls that changed lamp n.
func calls(p *fakePedal, n int) int {
	p.mu.Lock()
	defer p.mu.Unlock()
	k := 0
	var prev sparkx.Colour
	for _, l := range p.lamps {
		if l[n] != prev {
			k++
		}
		prev = l[n]
	}
	return k
}

func TestConnectedIndicator(t *testing.T) {
	cfg := indicatorCfg(mapping.IndicatorOff, mapping.IndicatorConnected)
	b, p, _, _, _ := setup(t, cfg)
	h := b.Handlers()
	h.Status(connected(false))
	if got := lamp(p, sparkx.LampApp); got != cfg.Indicators[mapping.IndicatorApp].Colour {
		t.Errorf("App %+v while connected, want its colour", got)
	}
	if got := lamp(p, sparkx.LampAmp); got != (sparkx.Colour{}) {
		t.Errorf("Amp %+v, want off", got)
	}
}

func TestUSBIndicator(t *testing.T) {
	cfg := indicatorCfg(mapping.IndicatorUSB, mapping.IndicatorOff)
	cfg.Brightness = 50
	b, p, _, _, _ := setup(t, cfg)
	h := b.Handlers()
	h.Status(connected(false))
	if got := lamp(p, sparkx.LampAmp); got != (sparkx.Colour{}) {
		t.Errorf("Amp lit on battery: %+v", got)
	}
	h.Status(connected(true))
	want := sparkx.Colour{R: 0, G: 0x58, B: 0x28} // the default green at 50 %
	if got := lamp(p, sparkx.LampAmp); got != want {
		t.Errorf("Amp on USB = %+v, want %+v", got, want)
	}
	h.Status(connected(false))
	if got := lamp(p, sparkx.LampAmp); got != (sparkx.Colour{}) {
		t.Errorf("Amp still lit after the cable came out: %+v", got)
	}
}

// A MIDI-out flash lights on the first message, stays lit while messages keep coming
// (each one extends it), and goes dark flashFor after the last: two lamp updates for
// the whole burst, however many messages.
func TestMIDIOutFlash(t *testing.T) {
	cfg := indicatorCfg(mapping.IndicatorMIDIOut, mapping.IndicatorOff)
	b, p, out, c, _ := setup(t, cfg)
	h := b.Handlers()
	h.Status(connected(false))
	h.Exp(0, 65535)
	if lamp(p, sparkx.LampAmp) == (sparkx.Colour{}) {
		t.Fatal("Amp dark after a message went out")
	}
	c.advance(80 * time.Millisecond)
	h.Exp(0, 0)
	c.advance(80 * time.Millisecond) // 160 ms after the first, 80 after the last
	b.Tick()
	if lamp(p, sparkx.LampAmp) == (sparkx.Colour{}) {
		t.Fatal("Amp dark 80 ms after the last message: the second did not extend the flash")
	}
	c.advance(flashFor - 80*time.Millisecond)
	b.Tick()
	if got := lamp(p, sparkx.LampAmp); got != (sparkx.Colour{}) {
		t.Fatalf("Amp still lit %v after the last message: %+v", flashFor, got)
	}
	if len(out.all()) != 2 {
		t.Fatalf("%d messages out, want 2", len(out.all()))
	}
	if n := calls(p, sparkx.LampAmp); n != 2 {
		t.Errorf("Amp changed %d times for one burst, want 2 (on, off)", n)
	}
}

func TestMIDIInFlash(t *testing.T) {
	cfg := indicatorCfg(mapping.IndicatorOff, mapping.IndicatorMIDIIn)
	b, p, _, c, _ := setup(t, cfg)
	b.Handlers().Status(connected(false))
	b.Feedback([]byte{0xB0, 1, 2})
	if lamp(p, sparkx.LampApp) == (sparkx.Colour{}) {
		t.Fatal("App dark after a message came in")
	}
	if lamp(p, sparkx.LampAmp) != (sparkx.Colour{}) {
		t.Fatal("Amp lit though off")
	}
	c.advance(flashFor)
	b.Tick()
	if got := lamp(p, sparkx.LampApp); got != (sparkx.Colour{}) {
		t.Errorf("App still lit after the flash: %+v", got)
	}
}

// Changing an indicator's mode or colour reaches the pedal at once.
func TestApplyChangesIndicators(t *testing.T) {
	b, p, _, _, _ := setup(t, indicatorCfg(mapping.IndicatorOff, mapping.IndicatorOff))
	b.Handlers().Status(connected(false))
	red := sparkx.Colour{R: 255}
	cfg := b.Config()
	cfg.Indicators[mapping.IndicatorAmp] = mapping.Indicator{Mode: mapping.IndicatorOn, Colour: red}
	if _, err := b.Apply(cfg); err != nil {
		t.Fatal(err)
	}
	if got := lamp(p, sparkx.LampAmp); got != red {
		t.Errorf("Amp %+v after Apply, want red", got)
	}
}
