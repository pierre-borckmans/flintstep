package ble

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"
)

// tinyScanner behaves like tinygo's darwin Adapter: Scan sets itself up (after
// setupDelay), then blocks until StopScan; StopScan fails when no Scan is set up.
type tinyScanner struct {
	setupDelay time.Duration

	mu sync.Mutex
	ch chan struct{}
}

func (f *tinyScanner) start(func(Device)) error {
	time.Sleep(f.setupDelay)
	ch := make(chan struct{})
	f.mu.Lock()
	f.ch = ch
	f.mu.Unlock()
	<-ch
	return nil
}

func (f *tinyScanner) stopScan() error {
	f.mu.Lock()
	ch := f.ch
	f.ch = nil
	f.mu.Unlock()
	if ch == nil {
		return errors.New("not calling Scan function")
	}
	close(ch)
	return nil
}

// Stop cancelling the loop's scan as it begins (say, after it waited for a UI scan to
// finish) must not leave the scan running forever, holding the scan lock.
func TestScanCancelledBeforeItStarts(t *testing.T) {
	f := &tinyScanner{setupDelay: 20 * time.Millisecond}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	done := make(chan struct{})
	go func() {
		_ = runScan(ctx, time.Hour, f.start, f.stopScan, func(Device) bool { return false })
		close(done)
	}()
	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("scan still running after its context was cancelled")
	}
}

func TestScanTimesOut(t *testing.T) {
	f := &tinyScanner{}
	start := time.Now()
	if err := runScan(context.Background(), 20*time.Millisecond, f.start, f.stopScan, func(Device) bool { return false }); err != nil {
		t.Fatal(err)
	}
	if d := time.Since(start); d > time.Second {
		t.Errorf("scan took %v", d)
	}
}

// fakeGATT discovers like tinygo: a list fails whole when any service is missing, and
// nil lists every service the pedal has, in its own order.
type fakeGATT struct {
	has   []string
	calls int
}

func (g *fakeGATT) discover(ids []string) ([]string, error) {
	g.calls++
	if ids == nil {
		return append([]string(nil), g.has...), nil
	}
	for _, id := range ids {
		found := false
		for _, h := range g.has {
			found = found || h == id
		}
		if !found {
			return nil, errors.New("bluetooth: did not find all requested services")
		}
	}
	return append([]string(nil), ids...), nil
}

func TestFindServices(t *testing.T) {
	id := func(s string) string { return s }
	req, opt := []string{"sw", "cmd"}, []string{"batt", "power"}
	for _, c := range []struct {
		name  string
		has   []string
		calls int
		want  []bool // optional found
		fails bool
	}{
		{"all there", []string{"x", "power", "cmd", "batt", "sw"}, 1, []bool{true, true}, false},
		{"no power service", []string{"batt", "sw", "cmd"}, 2, []bool{true, false}, false},
		{"no battery service", []string{"power", "cmd", "sw"}, 2, []bool{false, true}, false},
		{"neither", []string{"cmd", "sw"}, 2, []bool{false, false}, false},
		{"no switch service", []string{"cmd", "batt"}, 2, nil, true},
		{"no command service (an AirTurn page turner)", []string{"sw", "batt"}, 2, nil, true},
	} {
		g := &fakeGATT{has: c.has}
		r, o, err := findServices(req, opt, g.discover, id)
		if g.calls != c.calls {
			t.Errorf("%s: %d discoveries, want %d", c.name, g.calls, c.calls)
		}
		if c.fails {
			if !errors.Is(err, errIncompatible) {
				t.Errorf("%s: err = %v, want errIncompatible", c.name, err)
			}
			continue
		}
		if err != nil || len(r) != 2 || r[0] != "sw" || r[1] != "cmd" {
			t.Errorf("%s: required %v %v", c.name, r, err)
		}
		for i, w := range c.want {
			if (o[i] != nil) != w || (o[i] != nil && *o[i] != opt[i]) {
				t.Errorf("%s: optional %d = %v, want found %v", c.name, i, o[i], w)
			}
		}
	}
}
