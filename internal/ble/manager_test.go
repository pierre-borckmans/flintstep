package ble

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"flintstep/internal/sparkx"
)

func TestBackoff(t *testing.T) {
	want := []time.Duration{1, 2, 4, 8, 15, 15, 15}
	for n, w := range want {
		if got := backoff(n, time.Second, 15*time.Second); got != w*time.Second {
			t.Errorf("backoff(%d) = %v, want %v", n, got, w*time.Second)
		}
	}
	if got := backoff(1000, time.Second, 15*time.Second); got != 15*time.Second {
		t.Errorf("backoff(1000) = %v", got)
	}
}

// Bluetooth off: State off with the reason, retried until it comes on, then connected.
func TestOffThenOnConnects(t *testing.T) {
	rec := &recorder{}
	air := &fakeAir{off: "Bluetooth is off", answers: map[string]bool{"a": true}}
	m := newManager(rec.handlers(), air, fastTiming)
	m.SetLamps(indicatorsLit) // Amp and App lit, as the bridge sets them
	var got []Device
	var mu sync.Mutex
	m.OnConnected(func(d Device) { mu.Lock(); got = append(got, d); mu.Unlock() })
	m.Start(Target{Address: "a", Name: "SparkX a"})
	defer m.Stop()
	waitFor(t, "off", func() bool { return rec.sawState(StateOff, "Bluetooth is off") })
	if st := m.Status(); st.State != StateOff || st.Detail != "Bluetooth is off" {
		t.Errorf("status %+v", st)
	}
	air.setOff("")
	waitFor(t, "connected", func() bool { return m.Status().State == StateConnected })
	waitFor(t, "OnConnected", func() bool { mu.Lock(); defer mu.Unlock(); return len(got) == 1 })
	if got[0].Address != "a" {
		t.Errorf("OnConnected %+v", got)
	}
	waitFor(t, "connected reported", func() bool { return rec.sawState(StateConnected, "") })
	seq := rec.stateSeq()
	if seq[0] != StateOff || seq[len(seq)-1] != StateConnected {
		t.Errorf("states %v", seq)
	}
}

// A drop is followed by a reconnect, with "searching" in between.
func TestReconnectsAfterDrop(t *testing.T) {
	rec := &recorder{}
	air := &fakeAir{answers: map[string]bool{"a": true}}
	m := newManager(rec.handlers(), air, fastTiming)
	m.SetLamps(indicatorsLit) // Amp and App lit, as the bridge sets them
	m.Start(Target{Address: "a"})
	defer m.Stop()
	waitFor(t, "first connect", func() bool { return air.connCount() == 1 && m.Status().State == StateConnected })
	c := air.conn(0)
	c.s.dropped()
	waitFor(t, "reconnect", func() bool { return air.connCount() == 2 && m.Status().State == StateConnected })
	if !c.isClosed() {
		t.Error("the dropped conn was not closed")
	}
	// The old link is gone: nothing was written to it to go dark.
	if c.lampWrites(sparkx.LampAmp, sparkx.Colour{}) != 0 {
		t.Error("dark written to a dropped link")
	}
	if !rec.sawState(StateSearching, "Connection lost, reconnecting") {
		t.Errorf("states %v", rec.stateSeq())
	}
}

// Not found: backs off and keeps trying; the detail says so.
func TestRetriesWhenNotFound(t *testing.T) {
	rec := &recorder{}
	air := &fakeAir{}
	m := newManager(rec.handlers(), air, fastTiming)
	m.SetLamps(indicatorsLit) // Amp and App lit, as the bridge sets them
	m.Start(Target{})
	waitFor(t, "three scans", func() bool { air.mu.Lock(); defer air.mu.Unlock(); return air.scans >= 3 })
	m.Stop()
	if st := m.Status(); st.State != StateIdle {
		t.Errorf("after Stop: %s", st.State)
	}
	rec.mu.Lock()
	defer rec.mu.Unlock()
	found := false
	for _, s := range rec.states {
		if strings.HasPrefix(s.Detail, "Not found, trying again in") {
			found = true
		}
	}
	if !found {
		t.Errorf("no retry detail in %v", rec.states)
	}
}

// Stop: lamps dark, then the hang-up, then idle.
func TestStopGoesDarkThenDisconnects(t *testing.T) {
	rec := &recorder{}
	air := &fakeAir{answers: map[string]bool{"a": true}}
	m := newManager(rec.handlers(), air, fastTiming)
	m.SetLamps(indicatorsLit) // Amp and App lit, as the bridge sets them
	m.Start(Target{Address: "a"})
	waitFor(t, "connect", func() bool { return m.Status().State == StateConnected })
	c := air.conn(0)
	waitFor(t, "first flush", func() bool { return len(c.writes()) >= connectWrites })
	m.Stop()
	if !c.isClosed() {
		t.Fatal("not disconnected")
	}
	c.mu.Lock()
	n := len(c.log)
	last, darkApp := c.log[n-1], c.log[n-2]
	c.mu.Unlock()
	if last != nil {
		t.Error("the hang-up was not last")
	}
	if want := sparkx.LampMessages(sparkx.LampApp, sparkx.Colour{}); string(darkApp) != string(want[1]) {
		t.Errorf("before the hang-up: % x, want the App lamp dark", darkApp)
	}
	if st := m.Status(); st.State != StateIdle || st.Battery != sparkx.NoBattery || st.ExpRaw != [2]int{-1, -1} {
		t.Errorf("after Stop %+v", st)
	}
	waitFor(t, "idle reported", func() bool { return rec.sawState(StateIdle, "") })
}

// SetTarget to another pedal lets go of this one and connects that.
func TestSetTargetSwitchesPedal(t *testing.T) {
	air := &fakeAir{answers: map[string]bool{"a": true, "b": true}}
	m := newManager(Handlers{}, air, fastTiming)
	m.SetLamps(indicatorsLit) // Amp and App lit, as the bridge sets them
	m.Start(Target{Address: "a"})
	defer m.Stop()
	waitFor(t, "a", func() bool { return m.Status().State == StateConnected })
	m.SetTarget(Target{Address: "a"}) // same pedal: nothing happens
	time.Sleep(20 * time.Millisecond)
	if air.connCount() != 1 {
		t.Fatalf("reconnected to the same pedal: %v", air.dialled())
	}
	m.SetTarget(Target{Address: "b", Name: "SparkX b"})
	waitFor(t, "b", func() bool { st := m.Status(); return st.State == StateConnected && st.Address == "b" })
	if !air.conn(0).isClosed() || air.conn(0).lampWrites(sparkx.LampAmp, sparkx.Colour{}) != 2 {
		t.Error("a not let go of, dark")
	}
}

// Bluetooth going off while connected is noticed without a drop event.
func TestPowerOffWhileConnected(t *testing.T) {
	air := &fakeAir{answers: map[string]bool{"a": true}}
	m := newManager(Handlers{}, air, fastTiming)
	m.SetLamps(indicatorsLit) // Amp and App lit, as the bridge sets them
	m.Start(Target{Address: "a"})
	defer m.Stop()
	waitFor(t, "connect", func() bool { return m.Status().State == StateConnected })
	air.setOff("Bluetooth is off")
	waitFor(t, "off", func() bool { return m.Status().State == StateOff })
	if !air.conn(0).isClosed() {
		t.Error("conn kept")
	}
	air.setOff("")
	waitFor(t, "back", func() bool { return m.Status().State == StateConnected && air.connCount() == 2 })
}

// Scan waits for the reconnect loop's scan instead of overlapping it.
func TestScanSerialisedWithLoop(t *testing.T) {
	air := &fakeAir{scanTime: 20 * time.Millisecond}
	m := newManager(Handlers{}, air, fastTiming)
	m.SetLamps(indicatorsLit) // Amp and App lit, as the bridge sets them
	m.Start(Target{})
	defer m.Stop()
	for i := 0; i < 5; i++ {
		if _, err := m.Scan(20 * time.Millisecond); err != nil {
			t.Fatal(err)
		}
	}
	if n := air.overlaps.Load(); n != 0 {
		t.Errorf("%d overlapping scans", n)
	}
}

// Start, Stop, Start again: one loop at a time, and it connects.
func TestRestart(t *testing.T) {
	air := &fakeAir{answers: map[string]bool{"a": true}}
	m := newManager(Handlers{}, air, fastTiming)
	m.SetLamps(indicatorsLit) // Amp and App lit, as the bridge sets them
	m.Start(Target{Address: "a"})
	waitFor(t, "connect", func() bool { return m.Status().State == StateConnected })
	m.Stop()
	m.Stop() // twice is fine
	m.Start(Target{Address: "a"})
	defer m.Stop()
	waitFor(t, "reconnect", func() bool { return m.Status().State == StateConnected && air.connCount() == 2 })
}

func TestTraceLeavesOutExp(t *testing.T) {
	p := filepath.Join(t.TempDir(), "ble-trace.log")
	rec := &recorder{}
	_, s, _ := startSession(t, rec)
	s.m.trace.setPath(p)
	defer s.m.trace.setPath("")
	s.switches([]byte{1})
	s.command(cmd(0x0D, 1))
	s.command(expMsg(1, 2))
	s.m.trace.setPath("")
	b, err := os.ReadFile(p)
	if err != nil {
		t.Fatal(err)
	}
	out := string(b)
	if !strings.Contains(out, "RX sw  01") || !strings.Contains(out, "RX cmd 0d00000001") || strings.Contains(out, "0c000000") {
		t.Errorf("trace:\n%s", out)
	}
}

// slowDial holds the first dial until open is closed.
type slowDial struct {
	*fakeAir
	once    sync.Once
	arrived chan struct{}
	open    chan struct{}
}

func (a *slowDial) dial(ctx context.Context, addr string, timeout time.Duration, s sink) (conn, error) {
	a.once.Do(func() { close(a.arrived); <-a.open })
	return a.fakeAir.dial(ctx, addr, timeout, s)
}

// A pedal chosen while another connect is still dialling: when that dial lands, the
// old pedal must not be reported as connected, or the app remembers it over the
// user's choice.
func TestNoOnConnectedForAnOldTarget(t *testing.T) {
	air := &slowDial{fakeAir: &fakeAir{answers: map[string]bool{"a": true, "b": true}},
		arrived: make(chan struct{}), open: make(chan struct{})}
	m := newManager(Handlers{}, air, fastTiming)
	m.SetLamps(indicatorsLit) // Amp and App lit, as the bridge sets them
	var mu sync.Mutex
	var got []string
	m.OnConnected(func(d Device) { mu.Lock(); got = append(got, d.Address); mu.Unlock() })
	m.Start(Target{Address: "a"})
	defer m.Stop()
	<-air.arrived
	m.SetTarget(Target{Address: "b"})
	close(air.open)
	waitFor(t, "b", func() bool { mu.Lock(); defer mu.Unlock(); return len(got) > 0 && got[len(got)-1] == "b" })
	mu.Lock()
	defer mu.Unlock()
	if len(got) != 1 {
		t.Errorf("OnConnected for %v, want only b", got)
	}
}
