package bridge

import (
	"bytes"
	"sync"
	"testing"
	"time"

	"sparkbridge/internal/ble"
	"sparkbridge/internal/mapping"
	"sparkbridge/internal/sparkx"
)

var (
	trigOn  = []byte{0xB0, 102, 127}
	trigOff = []byte{0xB0, 102, 0}
)

func engageConfig() mapping.Config {
	cfg := mapping.Default()
	cfg.Exp[0].Trigger.Mode = mapping.TriggerEngage // CC 102, 4 %, 400 ms
	return cfg
}

// triggerLog records what OnTrigger reported.
type triggerLog struct {
	mu  sync.Mutex
	got [][sparkx.ExpInputs]bool
}

func (l *triggerLog) add(t [sparkx.ExpInputs]bool) {
	l.mu.Lock()
	l.got = append(l.got, t)
	l.mu.Unlock()
}

func (l *triggerLog) all() [][sparkx.ExpInputs]bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	return append([][sparkx.ExpInputs]bool(nil), l.got...)
}

func setupTrigger(t *testing.T, cfg mapping.Config) (*Bridge, *fakeOut, *clock, *triggerLog) {
	t.Helper()
	c := &clock{t: time.Unix(1_000_000, 0)}
	out := &fakeOut{}
	log := &triggerLog{}
	b := New(cfg, out, Options{Now: c.now, OnTrigger: log.add})
	t.Cleanup(b.Close)
	b.SetPedal(&fakePedal{})
	return b, out, c, log
}

func has(msgs [][]byte, m []byte) bool {
	for _, x := range msgs {
		if bytes.Equal(x, m) {
			return true
		}
	}
	return false
}

func TestTriggerEngagesAndReleasesAfterDelay(t *testing.T) {
	b, out, c, log := setupTrigger(t, engageConfig())
	h := b.Handlers()
	h.Exp(0, 0)
	h.Exp(0, 30000)
	if !has(out.all(), trigOn) {
		t.Fatalf("rising past 4 %% sent % x, want CC 102 = 127", out.all())
	}
	if b.ExpTriggers() != [2]bool{true, false} {
		t.Fatalf("ExpTriggers = %v", b.ExpTriggers())
	}
	h.Exp(0, 0)
	if has(out.all(), trigOff) {
		t.Fatal("released at once despite the 400 ms off delay")
	}
	c.advance(410 * time.Millisecond)
	b.Tick()
	if !has(out.all(), trigOff) {
		t.Fatalf("no release after the off delay: % x", out.all())
	}
	want := [][2]bool{{true, false}, {false, false}}
	if got := log.all(); len(got) != 2 || got[0] != want[0] || got[1] != want[1] {
		t.Fatalf("OnTrigger got %v, want %v", got, want)
	}
}

func TestTriggerOffDelayTicksOnItsOwn(t *testing.T) {
	// With no edge or value to come, the tick loop alone must end the off delay.
	b, out, _, _ := setupTrigger(t, engageConfig())
	b.now = func() time.Time { return time.Now() }
	cfg := engageConfig()
	cfg.Exp[0].Trigger.OffDelayMS = 30
	if _, err := b.Apply(cfg); err != nil {
		t.Fatal(err)
	}
	h := b.Handlers()
	h.Exp(0, 30000)
	h.Exp(0, 0)
	deadline := time.Now().Add(2 * time.Second)
	for !has(out.all(), trigOff) {
		if time.Now().After(deadline) {
			t.Fatal("the off delay never ended without a Tick from the test")
		}
		time.Sleep(5 * time.Millisecond)
	}
}

func TestTriggerReleasedOnDisconnect(t *testing.T) {
	b, out, _, _ := setupTrigger(t, engageConfig())
	h := b.Handlers()
	h.Exp(0, 30000)
	h.Status(ble.Status{State: ble.StateSearching})
	sent := out.all()
	if !bytes.Equal(sent[len(sent)-1], trigOff) {
		t.Fatalf("after a drop sent % x, want CC 102 = 0 last", sent)
	}
	if b.ExpTriggers()[0] {
		t.Fatal("still engaged after the drop")
	}
}

func TestTriggerReleasedOnCableOut(t *testing.T) {
	b, out, _, _ := setupTrigger(t, engageConfig())
	h := b.Handlers()
	st := ble.Status{State: ble.StateConnected}
	st.Cables = [2]bool{true, false}
	h.Status(st)
	h.Exp(0, 30000)
	h.Status(st) // cable 2 out says nothing about input 1
	if has(out.all(), trigOff) {
		t.Fatal("released input 1 for input 2's missing cable")
	}
	st.Cables = [2]bool{false, false}
	h.Status(st)
	sent := out.all()
	if !bytes.Equal(sent[len(sent)-1], trigOff) {
		t.Fatalf("after the cable came out sent % x, want CC 102 = 0 last", sent)
	}
}

func TestTriggerReleasedWhenConfigChanges(t *testing.T) {
	b, out, _, log := setupTrigger(t, engageConfig())
	b.Handlers().Exp(0, 30000)
	cfg := engageConfig()
	cfg.Exp[0].Trigger.Mode = mapping.TriggerOff
	if _, err := b.Apply(cfg); err != nil {
		t.Fatal(err)
	}
	sent := out.all()
	if !bytes.Equal(sent[len(sent)-1], trigOff) {
		t.Fatalf("turning the trigger off sent % x, want CC 102 = 0 last", sent)
	}
	if got := log.all(); len(got) != 2 || got[1] != [2]bool{} {
		t.Fatalf("OnTrigger got %v", got)
	}
}
