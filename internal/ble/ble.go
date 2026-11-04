// Package ble keeps one Positive Grid Spark Control X connected over Bluetooth LE and
// turns what it sends into switch edges, raw expression values and a Status for the UI.
//
// The protocol itself is internal/sparkx. This package is the connection: finding the
// pedal (find.go), keeping it connected (loop.go), and talking to it while it is
// (session.go). CoreBluetooth sits behind the radio interface (radio.go), so all of
// that is tested without a radio.
package ble

import (
	"context"
	"io"
	"log"
	"sync"
	"time"

	"sparkbridge/internal/sparkx"
)

// State is where the connection stands.
type State string

const (
	StateOff        State = "off" // Bluetooth off, unauthorised or missing
	StateIdle       State = "idle"
	StateSearching  State = "searching"
	StateConnecting State = "connecting"
	StateConnected  State = "connected"
)

// Device is a Spark Control X found by Scan.
type Device struct {
	Name    string `json:"name"`
	Address string `json:"address"`
	RSSI    int    `json:"rssi"`
	// System marks a pedal macOS already holds a connection to: it does not advertise,
	// so only the system query finds it.
	System bool `json:"system"`
}

// Target is the pedal the Manager should keep connected: mapping.PedalRef, without
// the import. An empty Address means the first Spark Control X found.
type Target struct {
	Address string
	Name    string
}

// Status is the connection and the pedal, for the UI.
type Status struct {
	State  State  `json:"state"`
	Detail string `json:"detail"` // human words for the state, e.g. "Bluetooth is off"
	// Name and Address are the pedal connected, being connected to, or wanted.
	Name    string `json:"name"`
	Address string `json:"address"`
	sparkx.Status
	// ExpRaw is the last raw value (0..65535) per expression input, -1 with no cable or
	// no reading yet.
	ExpRaw [sparkx.ExpInputs]int `json:"expRaw"`
}

// Handlers are the Manager's outputs. Each is called on a goroutine of the Manager's,
// never on CoreBluetooth's thread; any may be nil.
type Handlers struct {
	// Switch gets every switch edge, in order.
	Switch func(sparkx.Edge)
	// Exp gets the raw expression value (0..65535) of an input with a cable, about 60
	// times a second. Calibration and scaling are the caller's.
	Exp func(n, raw int)
	// Status gets the status whenever it changes, at most every 50 ms. Every state
	// change is delivered, in order.
	Status func(Status)
}

// Manager keeps one Spark Control X connected. Safe for concurrent use.
type Manager struct {
	h  Handlers
	r  radio
	tm timing

	mu       sync.Mutex
	state    State
	detail   string
	name     string
	addr     string
	cur      *session // the connected pedal, nil when none
	target   Target
	lamps    [sparkx.Switches]sparkx.Colour
	onConn   func(Device)
	pending  []Status // state changes not yet reported
	run      *runner  // the reconnect loop, nil when stopped
	lastDone chan struct{}

	trace traceFile

	// scanMu serialises radio scans: the reconnect loop's and Scan's. tinygo keeps one
	// scan per adapter and two overlapping ones fail or race.
	scanMu sync.Mutex

	wake   chan struct{} // SetTarget nudges the loop
	kickCh chan struct{} // the status changed
	events chan event    // edges and exp values, to the dispatcher
}

// timing is every delay the Manager uses, so tests can shrink them.
type timing struct {
	backoffMin, backoffMax time.Duration // between failed connect attempts
	offRetry               time.Duration // between checks while Bluetooth is off
	powerPoll              time.Duration // power checks while connected
	stopWait               time.Duration // the longest Stop waits for the loop
	statusEvery            time.Duration // the most often Status is reported
	darkWait               time.Duration // how long a hang-up waits for the lamps to go dark
	batteryPoll            time.Duration
	idDial                 time.Duration // a remembered pedal the Mac does not hold
	heldDial               time.Duration // a pedal the Mac holds: answers at once
	scanFor                time.Duration // the connect path's scan
}

var defaultTiming = timing{
	backoffMin:  time.Second,
	backoffMax:  15 * time.Second,
	offRetry:    5 * time.Second,
	powerPoll:   2 * time.Second,
	stopWait:    3 * time.Second,
	statusEvery: 50 * time.Millisecond,
	darkWait:    600 * time.Millisecond,
	batteryPoll: 60 * time.Second,
	idDial:      4 * time.Second,
	heldDial:    10 * time.Second,
	scanFor:     5 * time.Second,
}

type runner struct {
	cancel context.CancelFunc
	done   chan struct{}
}

// event is one thing for the dispatcher: an edge, or an expression value.
type event struct {
	exp  bool
	edge sparkx.Edge
	n    int
	raw  int
}

// eventBuffer holds edges and exp values between CoreBluetooth's thread and the
// handlers. Exp values are dropped once it is half full, so edges always fit.
const eventBuffer = 512

// NewManager returns a stopped Manager on the system's Bluetooth adapter. tracePath,
// when not "", gets every RX/TX buffer except the expression stream (rotated at
// TraceMax).
func NewManager(h Handlers, tracePath string) *Manager {
	m := newManager(h, newRadio(), defaultTiming)
	m.trace.setPath(tracePath)
	return m
}

func newManager(h Handlers, r radio, tm timing) *Manager {
	m := &Manager{
		h:      h,
		r:      r,
		tm:     tm,
		state:  StateIdle,
		wake:   make(chan struct{}, 1),
		kickCh: make(chan struct{}, 1),
		events: make(chan event, eventBuffer),
	}
	go m.report()
	go m.dispatch()
	return m
}

// Start keeps target connected: it connects, waits for a drop and reconnects, with a
// backoff of 1 s to 15 s between failures, until Stop. An empty target takes the first
// Spark Control X found. Starting a running Manager only changes the target.
func (m *Manager) Start(target Target) {
	m.mu.Lock()
	m.target = target
	if m.name == "" && m.addr == "" {
		m.name, m.addr = target.Name, target.Address
	}
	if m.run != nil {
		m.mu.Unlock()
		m.nudge()
		return
	}
	ctx, cancel := context.WithCancel(context.Background())
	r := &runner{cancel: cancel, done: make(chan struct{})}
	prev := m.lastDone
	m.run, m.lastDone = r, r.done
	m.mu.Unlock()
	log.Printf("ble: start, %s", describe(target))
	go m.loop(ctx, prev, r.done)
}

// SetTarget changes the pedal to keep connected. A pedal connected now that is not the
// new target is let go of, and the new one connected.
func (m *Manager) SetTarget(target Target) {
	m.mu.Lock()
	m.target = target
	if m.cur == nil {
		m.name, m.addr = target.Name, target.Address
	}
	m.mu.Unlock()
	log.Printf("ble: target %s", describe(target))
	m.nudge()
}

// Stop turns the lamps off, hangs up and stops reconnecting. It waits a few seconds at
// most: a connect attempt in progress finishes on its own and is then hung up.
func (m *Manager) Stop() {
	m.mu.Lock()
	r := m.run
	m.run = nil
	m.mu.Unlock()
	if r == nil {
		return
	}
	log.Printf("ble: stop")
	r.cancel()
	select {
	case <-r.done:
	case <-time.After(m.tm.stopWait):
		log.Printf("ble: stop did not finish in %v; the connect in progress hangs up when it returns", m.tm.stopWait)
	}
}

// SetLamps sets the six switch lamps. Only lamps that changed are written. They are
// kept across reconnects.
func (m *Manager) SetLamps(l [sparkx.Switches]sparkx.Colour) {
	m.mu.Lock()
	m.lamps = l
	s := m.cur
	m.mu.Unlock()
	if s != nil {
		s.setLamps(l)
	}
}

// OnConnected installs fn, called with the pedal after each successful connect to the
// target of the moment (not for a dial that lands after SetTarget changed it).
func (m *Manager) OnConnected(fn func(Device)) {
	m.mu.Lock()
	m.onConn = fn
	m.mu.Unlock()
}

// Status is the status now.
func (m *Manager) Status() Status {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.statusLocked()
}

func (m *Manager) statusLocked() Status {
	st := Status{State: m.state, Detail: m.detail, Name: m.name, Address: m.addr}
	if s := m.cur; s != nil {
		st.Status, st.ExpRaw = s.snapshot()
	} else {
		st.Status, st.ExpRaw = sparkx.NewStatus(), [sparkx.ExpInputs]int{-1, -1}
	}
	return st
}

// setState records a state change and queues it for the Status handler.
func (m *Manager) setState(s State, detail string) {
	m.mu.Lock()
	if m.state == s && m.detail == detail {
		m.mu.Unlock()
		return
	}
	m.state, m.detail = s, detail
	m.pending = append(m.pending, m.statusLocked())
	m.mu.Unlock()
	m.kick()
}

// kick says the status changed. Never blocks.
func (m *Manager) kick() {
	select {
	case m.kickCh <- struct{}{}:
	default:
	}
}

// nudge wakes the loop from a wait.
func (m *Manager) nudge() {
	select {
	case m.wake <- struct{}{}:
	default:
	}
}

// report hands the status to the handler: every queued state change, then the status
// now if it differs from the last one sent; then waits statusEvery.
func (m *Manager) report() {
	var last Status
	sent := false
	send := func(st Status) {
		if sent && st == last {
			return
		}
		last, sent = st, true
		if m.h.Status != nil {
			m.h.Status(st)
		}
	}
	for range m.kickCh {
		m.mu.Lock()
		ps := m.pending
		m.pending = nil
		now := m.statusLocked()
		m.mu.Unlock()
		for _, p := range ps {
			send(p)
		}
		send(now)
		time.Sleep(m.tm.statusEvery)
	}
}

// dispatch delivers edges and exp values off CoreBluetooth's thread.
func (m *Manager) dispatch() {
	for e := range m.events {
		switch {
		case e.exp && m.h.Exp != nil:
			m.h.Exp(e.n, e.raw)
		case !e.exp && m.h.Switch != nil:
			m.h.Switch(e.edge)
		}
	}
}

// emit queues an event. Never blocks: exp values give way once the buffer is half
// full, so a backlog never costs an edge.
func (m *Manager) emit(e event) {
	if e.exp && len(m.events) > eventBuffer/2 {
		return
	}
	select {
	case m.events <- e:
	default:
	}
}

// traceFile is the optional wire trace.
type traceFile struct {
	mu   sync.Mutex
	path string
	w    io.WriteCloser
}
