package ble

import (
	"testing"
	"time"

	"flintstep/internal/sparkx"
)

// startSession is a session on a fake conn, as the loop would start it.
func startSession(t *testing.T, rec *recorder) (*Manager, *session, *fakeConn) {
	t.Helper()
	m := newManager(rec.handlers(), &fakeAir{}, fastTiming)
	s := newSession(m, Device{Name: "SparkX t", Address: "a"})
	c := &fakeConn{addr: "a", s: s}
	m.mu.Lock()
	m.cur = s
	m.mu.Unlock()
	s.start(c, indicatorsLit)
	t.Cleanup(s.stop)
	return m, s, c
}

// Amp and App lit, as the bridge sets them on connect.
var (
	ampOn         = sparkx.Colour{G: 0xB0, B: 0x50}
	appOn         = sparkx.Colour{R: 0x40, G: 0x20, B: 0xFF}
	indicatorsLit = func() (l [sparkx.Lamps]sparkx.Colour) {
		l[sparkx.LampAmp], l[sparkx.LampApp] = ampOn, appOn
		return l
	}()
)

// connectWrites is what a connect writes: every lamp once and the five info requests.
const connectWrites = sparkx.Lamps*2 + 5

var connectRequests = [][]byte{sparkx.FirmwareRequest(), sparkx.ProfileRequest(), sparkx.BatteryRequest(), sparkx.CablesRequest(), sparkx.PowerRequest()}

func cmd(kind byte, payload ...byte) []byte { return append([]byte{kind, 0, 0, 0}, payload...) }

// On connect every lamp is written once (the pedal's state is unknown), as the caller
// set them, and the five info requests sent.
func TestConnectWritesAllLampsAndRequests(t *testing.T) {
	_, _, c := startSession(t, &recorder{})
	waitFor(t, "lamps and requests", func() bool { return len(c.writes()) >= connectWrites })
	for n := 0; n < sparkx.Switches; n++ {
		if c.lampWrites(n, sparkx.Colour{}) != 2 {
			t.Errorf("lamp %d not written dark once", n)
		}
	}
	if c.lampWrites(sparkx.LampAmp, ampOn) != 2 || c.lampWrites(sparkx.LampApp, appOn) != 2 {
		t.Error("Amp/App lamps not lit")
	}
	for _, r := range connectRequests {
		if c.count(r) != 1 {
			t.Errorf("request % x sent %d times", r, c.count(r))
		}
	}
}

// Only lamps that changed are written.
func TestSetLampsWritesOnlyChanges(t *testing.T) {
	m, _, c := startSession(t, &recorder{})
	waitFor(t, "first flush", func() bool { return len(c.writes()) >= connectWrites })
	before := len(c.writes())
	red := sparkx.Colour{R: 255}
	l := indicatorsLit
	l[2] = red
	m.SetLamps(l)
	waitFor(t, "lamp 2", func() bool { return c.lampWrites(2, red) == 2 })
	m.SetLamps(l) // nothing new
	m.SetLamps(l)
	waitFor(t, "status lamps", func() bool { return m.Status().Lamps[2] == red })
	if got := len(c.writes()) - before; got != 2 {
		t.Errorf("%d writes for one changed lamp, want 2", got)
	}
}

// Going dark writes only the lamps that were lit.
func TestGoDarkWritesLitLamps(t *testing.T) {
	_, s, c := startSession(t, &recorder{})
	waitFor(t, "first flush", func() bool { return len(c.writes()) >= connectWrites })
	before := len(c.writes())
	s.end(true)
	if !c.isClosed() {
		t.Fatal("not closed")
	}
	if got := len(c.writes()) - before; got != 4 {
		t.Errorf("%d dark writes, want 4 (Amp and App)", got)
	}
	if c.lampWrites(sparkx.LampAmp, sparkx.Colour{}) != 2 || c.lampWrites(sparkx.LampApp, sparkx.Colour{}) != 2 {
		t.Error("Amp/App not turned off")
	}
	if c.log[len(c.log)-1] != nil {
		t.Error("a write after the hang-up")
	}
}

func TestSwitchEdgesInOrder(t *testing.T) {
	rec := &recorder{}
	m, s, _ := startSession(t, rec)
	s.switches([]byte{0b000001})
	s.switches([]byte{0b000110}) // 0 up, then 1 and 2 down
	waitFor(t, "edges", func() bool { rec.mu.Lock(); defer rec.mu.Unlock(); return len(rec.edges) == 4 })
	want := []sparkx.Edge{{Switch: 0, Down: true}, {Switch: 0}, {Switch: 1, Down: true}, {Switch: 2, Down: true}}
	for i, e := range want {
		if rec.edges[i] != e {
			t.Errorf("edge %d = %+v, want %+v", i, rec.edges[i], e)
		}
	}
	if m.Status().Held != 0b110 {
		t.Errorf("held %b", m.Status().Held)
	}
}

func expMsg(a, b int) []byte {
	return cmd(0x0C, 1, byte(a), byte(a>>8), 2, byte(b), byte(b>>8))
}

// Raw exp values reach the handler only for inputs with a cable; unplugging forgets.
func TestExpRawOnlyWithCable(t *testing.T) {
	rec := &recorder{}
	m, s, _ := startSession(t, rec)
	s.command(expMsg(1000, 2000)) // no cables known yet
	s.command(cmd(0x0D, 0b10))    // a cable in input 2
	s.command(expMsg(65535, 30000))
	waitFor(t, "exp", func() bool { rec.mu.Lock(); defer rec.mu.Unlock(); return len(rec.exps) == 1 })
	if rec.exps[0] != [2]int{1, 30000} {
		t.Errorf("exp = %v", rec.exps)
	}
	st := m.Status()
	if st.ExpRaw != [2]int{-1, 30000} || st.Cables != [2]bool{false, true} || st.Exp[0] != -1 || st.Exp[1] != 58 {
		t.Errorf("status %+v", st)
	}
	s.command(cmd(0x0D, 0))
	if st := m.Status(); st.ExpRaw != [2]int{-1, -1} || st.Exp[1] != -1 {
		t.Errorf("after unplug %+v", st)
	}
}

func TestInfoReplies(t *testing.T) {
	m, s, c := startSession(t, &recorder{})
	s.command(append(cmd(0x0B, 0x05), []byte("4.1.23\x00\x00")...))
	s.command(cmd(0x08, 3))
	s.command(append(cmd(0x12, 3), []byte("Live\x00")...))
	s.command(cmd(0x0F, 87))
	st := m.Status()
	if st.Firmware != "4.1.23" || st.Profile != 3 || st.ProfileName != "Live" || st.Battery != 87 {
		t.Errorf("status %+v", st.Status)
	}
	waitFor(t, "profile name request", func() bool { return c.count(sparkx.ProfileNameRequest(3)) == 1 })
	s.battery(50)
	if m.Status().Battery != 50 {
		t.Error("battery service reading not taken")
	}
}

func TestBatteryLevel(t *testing.T) {
	for _, c := range []struct {
		in   []byte
		want int
		ok   bool
	}{{nil, 0, false}, {[]byte{101}, 0, false}, {[]byte{42, 9}, 42, true}, {[]byte{100}, 100, true}} {
		if v, ok := batteryLevel(c.in); v != c.want || ok != c.ok {
			t.Errorf("batteryLevel(%v) = %d %v", c.in, v, ok)
		}
	}
}

// Once a hang-up has turned the lamps dark, a lamp update racing it (a switch press,
// LED feedback) must not light them again before the link closes.
func TestNoLampsAfterGoingDark(t *testing.T) {
	m, s, c := startSession(t, &recorder{})
	waitFor(t, "first flush", func() bool { return len(c.writes()) >= connectWrites })
	s.goDark()
	red := sparkx.Colour{R: 255}
	var l [sparkx.Lamps]sparkx.Colour
	l[2] = red
	m.SetLamps(l)
	time.Sleep(50 * time.Millisecond)
	if n := c.lampWrites(2, red); n != 0 {
		t.Errorf("lamp 2 lit again after going dark (%d writes)", n)
	}
}

// Another host can darken our lamps without telling us, so they are rewritten on a
// timer even when nothing changed.
func TestLampsRewrittenPeriodically(t *testing.T) {
	m := newManager((&recorder{}).handlers(), &fakeAir{}, fastTiming)
	m.tm.lampRefresh = 20 * time.Millisecond
	s := newSession(m, Device{Name: "SparkX t", Address: "a"})
	c := &fakeConn{addr: "a", s: s}
	m.mu.Lock()
	m.cur = s
	m.mu.Unlock()
	s.start(c, indicatorsLit)
	t.Cleanup(s.stop)
	waitFor(t, "a refresh of the App lamp", func() bool { return c.lampWrites(sparkx.LampApp, appOn) >= 4 })
}

// The Amp and App lamps are the caller's like the others: SetLamps changes them.
func TestSetLampsDrivesIndicators(t *testing.T) {
	m, _, c := startSession(t, &recorder{})
	waitFor(t, "first flush", func() bool { return len(c.writes()) >= connectWrites })
	l := indicatorsLit
	l[sparkx.LampAmp] = sparkx.Colour{}
	m.SetLamps(l)
	waitFor(t, "Amp dark", func() bool { return c.lampWrites(sparkx.LampAmp, sparkx.Colour{}) == 2 })
	if got := m.Status().Lamps[sparkx.LampApp]; got != appOn {
		t.Errorf("App lamp %+v, want it kept", got)
	}
}

// USB power comes from the 0x11 reply and from the power characteristic; either one
// sets Powered, and the status is reported.
func TestPowerFromReplyAndCharacteristic(t *testing.T) {
	rec := &recorder{}
	m, s, _ := startSession(t, rec)
	if m.Status().Powered {
		t.Fatal("powered before the pedal said so")
	}
	s.command(cmd(0x11, 1))
	if !m.Status().Powered {
		t.Error("0x11 reply 01 not read as USB power")
	}
	waitFor(t, "powered reported", func() bool {
		rec.mu.Lock()
		defer rec.mu.Unlock()
		return len(rec.states) > 0 && rec.states[len(rec.states)-1].Powered
	})
	s.power(false)
	if m.Status().Powered {
		t.Error("the characteristic's 00 not read as battery")
	}
	s.command(cmd(0x11, 0x07)) // not a power value: ignored
	s.power(true)
	s.command(cmd(0x11, 0x07))
	if !m.Status().Powered {
		t.Error("a malformed 0x11 reply changed the power state")
	}
}

// The battery poll asks for the power state too: the level moves while charging, and
// the cable can come out between polls.
func TestPollAsksBatteryAndPower(t *testing.T) {
	m := newManager((&recorder{}).handlers(), &fakeAir{}, fastTiming)
	m.tm.batteryPoll = 10 * time.Millisecond
	s := newSession(m, Device{Name: "SparkX t", Address: "a"})
	c := &fakeConn{addr: "a", s: s}
	s.start(c, indicatorsLit)
	t.Cleanup(s.stop)
	waitFor(t, "two polls", func() bool {
		return c.count(sparkx.BatteryRequest()) >= 3 && c.count(sparkx.PowerRequest()) >= 3
	})
}

func TestDefaultBatteryPollIs15s(t *testing.T) {
	if defaultTiming.batteryPoll != 15*time.Second {
		t.Errorf("battery poll %v, want 15 s", defaultTiming.batteryPoll)
	}
}

func TestUSBPowerValue(t *testing.T) {
	for _, c := range []struct {
		in     []byte
		on, ok bool
	}{{nil, false, false}, {[]byte{1}, true, true}, {[]byte{0}, false, true}, {[]byte{2}, false, false}, {[]byte{1, 9}, true, true}} {
		if on, ok := usbPower(c.in); on != c.on || ok != c.ok {
			t.Errorf("usbPower(%v) = %v %v", c.in, on, ok)
		}
	}
}
