package ble

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"log"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"flintstep/internal/sparkx"
)

// fakeAir is a radio: whether Bluetooth is on, what the Mac holds, what advertises, and
// which addresses answer a connect. It records what the Manager asked of it.
type fakeAir struct {
	mu      sync.Mutex
	off     string // non-empty: Bluetooth is off, for this reason
	system  []Device
	adverts []Device
	answers map[string]bool
	// gatt is what a connected device turns out to have, by address: one without both
	// the switch and the command service fails the dial as the real setup does. An
	// address missing here is a pedal.
	gatt      map[string][]string
	dials     []string
	budgets   []time.Duration
	scans     int
	scanTime  time.Duration // how long each scan runs before giving up
	conns     []*fakeConn
	scanning  atomic.Int32
	overlaps  atomic.Int32
	enableErr error
}

func (a *fakeAir) power() (bool, string) {
	a.mu.Lock()
	defer a.mu.Unlock()
	return a.off == "", a.off
}

func (a *fakeAir) setOff(why string) {
	a.mu.Lock()
	a.off = why
	a.mu.Unlock()
}

func (a *fakeAir) enable() error {
	a.mu.Lock()
	defer a.mu.Unlock()
	return a.enableErr
}

func (a *fakeAir) held() ([]Device, error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	return append([]Device(nil), a.system...), nil
}

func (a *fakeAir) scan(ctx context.Context, _ time.Duration, visit func(Device) bool) error {
	if a.scanning.Add(1) > 1 {
		a.overlaps.Add(1)
	}
	defer a.scanning.Add(-1)
	a.mu.Lock()
	a.scans++
	ads := append([]Device(nil), a.adverts...)
	wait := a.scanTime
	a.mu.Unlock()
	for _, ad := range ads {
		if visit(ad) {
			return nil
		}
	}
	select {
	case <-time.After(wait):
	case <-ctx.Done():
	}
	return nil
}

func (a *fakeAir) dial(_ context.Context, addr string, timeout time.Duration, s sink) (conn, error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	a.dials = append(a.dials, addr)
	a.budgets = append(a.budgets, timeout)
	if !a.answers[addr] {
		return nil, errors.New("no answer")
	}
	if svcs, ok := a.gatt[addr]; ok && !sparkx.HasServices(svcs) {
		return nil, fmt.Errorf("discover the pedal's services: %w", errIncompatible)
	}
	c := &fakeConn{addr: addr, s: s}
	a.conns = append(a.conns, c)
	return c, nil
}

func (a *fakeAir) dialled() []string {
	a.mu.Lock()
	defer a.mu.Unlock()
	return append([]string(nil), a.dials...)
}

func (a *fakeAir) conn(n int) *fakeConn {
	a.mu.Lock()
	defer a.mu.Unlock()
	if n >= len(a.conns) {
		return nil
	}
	return a.conns[n]
}

func (a *fakeAir) connCount() int {
	a.mu.Lock()
	defer a.mu.Unlock()
	return len(a.conns)
}

// fakeConn records every write and the hang-up, in order.
type fakeConn struct {
	addr string
	s    sink

	mu     sync.Mutex
	log    [][]byte // writes; a nil entry is the close
	closed bool
}

func (c *fakeConn) write(b []byte) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.closed {
		return errors.New("closed")
	}
	c.log = append(c.log, append([]byte(nil), b...))
	return nil
}

func (c *fakeConn) close() {
	c.mu.Lock()
	defer c.mu.Unlock()
	if !c.closed {
		c.closed = true
		c.log = append(c.log, nil)
	}
}

func (c *fakeConn) isClosed() bool {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.closed
}

func (c *fakeConn) writes() [][]byte {
	c.mu.Lock()
	defer c.mu.Unlock()
	var out [][]byte
	for _, w := range c.log {
		if w != nil {
			out = append(out, w)
		}
	}
	return out
}

// lampWrites counts the lamp messages written for lamp n with colour col.
func (c *fakeConn) lampWrites(n int, col sparkx.Colour) int {
	want := sparkx.LampMessages(n, col)
	k := 0
	for _, w := range c.writes() {
		for _, m := range want {
			if bytes.Equal(w, m) {
				k++
			}
		}
	}
	return k
}

func (c *fakeConn) count(b []byte) int {
	k := 0
	for _, w := range c.writes() {
		if bytes.Equal(w, b) {
			k++
		}
	}
	return k
}

var fastTiming = timing{
	backoffMin:  5 * time.Millisecond,
	backoffMax:  40 * time.Millisecond,
	offRetry:    5 * time.Millisecond,
	powerPoll:   5 * time.Millisecond,
	stopWait:    2 * time.Second,
	statusEvery: time.Millisecond,
	darkWait:    500 * time.Millisecond,
	batteryPoll: time.Hour,
	lampRefresh: time.Hour,
	idDial:      4 * time.Second,
	heldDial:    10 * time.Second,
	scanFor:     10 * time.Millisecond,
}

// recorder collects what the handlers get.
type recorder struct {
	mu     sync.Mutex
	edges  []sparkx.Edge
	exps   [][2]int
	states []Status
}

func (r *recorder) handlers() Handlers {
	return Handlers{
		Switch: func(e sparkx.Edge) { r.mu.Lock(); r.edges = append(r.edges, e); r.mu.Unlock() },
		Exp:    func(n, raw int) { r.mu.Lock(); r.exps = append(r.exps, [2]int{n, raw}); r.mu.Unlock() },
		Status: func(s Status) { r.mu.Lock(); r.states = append(r.states, s); r.mu.Unlock() },
	}
}

func (r *recorder) stateSeq() []State {
	r.mu.Lock()
	defer r.mu.Unlock()
	var out []State
	for _, s := range r.states {
		if len(out) == 0 || out[len(out)-1] != s.State {
			out = append(out, s.State)
		}
	}
	return out
}

func (r *recorder) sawState(st State, detail string) bool {
	r.mu.Lock()
	defer r.mu.Unlock()
	for _, s := range r.states {
		if s.State == st && (detail == "" || s.Detail == detail) {
			return true
		}
	}
	return false
}

func waitFor(t *testing.T, what string, cond func() bool) {
	t.Helper()
	deadline := time.Now().Add(3 * time.Second)
	for !cond() {
		if time.Now().After(deadline) {
			t.Fatalf("timed out waiting for %s", what)
		}
		time.Sleep(time.Millisecond)
	}
}

// captureLog collects the log.
func captureLog(t *testing.T) *syncBuf {
	t.Helper()
	b := &syncBuf{}
	prev, flags := log.Writer(), log.Flags()
	log.SetOutput(b)
	log.SetFlags(0)
	t.Cleanup(func() { log.SetOutput(prev); log.SetFlags(flags) })
	return b
}

type syncBuf struct {
	mu sync.Mutex
	b  bytes.Buffer
}

func (s *syncBuf) Write(p []byte) (int, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.b.Write(p)
}

func (s *syncBuf) String() string {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.b.String()
}
