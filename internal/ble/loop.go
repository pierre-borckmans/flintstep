package ble

import (
	"context"
	"errors"
	"fmt"
	"log"
	"strings"
	"time"
)

// KEEPING THE PEDAL CONNECTED.
//
// Start runs loop until Stop: check Bluetooth, connect (find.go), hold the connection
// until it drops, the target changes, Bluetooth goes off or Stop; then go round again.
// Failed attempts back off from 1 s to 15 s; Bluetooth being off is checked every few
// seconds, forever. The status says which of these it is doing.

// backoff is the wait after the n-th failed attempt in a row (0-based): doubling from
// min, capped at max.
func backoff(n int, lo, hi time.Duration) time.Duration {
	d := lo
	for i := 0; i < n && d < hi; i++ {
		d *= 2
	}
	return min(d, hi)
}

// holdEnd is why a connection ended.
type holdEnd int

const (
	endStop holdEnd = iota
	endLost
	endTarget
	endPower
)

func (m *Manager) loop(ctx context.Context, prev <-chan struct{}, done chan struct{}) {
	defer close(done)
	if prev != nil {
		select {
		case <-prev: // an earlier loop still hanging up
		case <-ctx.Done():
			return
		}
	}
	defer m.setState(StateIdle, "")
	failures := 0
	offLogged := ""
	for ctx.Err() == nil {
		if on, detail := m.r.power(); !on {
			if offLogged != detail {
				log.Printf("ble: %s", detail)
				offLogged = detail
			}
			m.setState(StateOff, detail)
			m.sleep(ctx, m.tm.offRetry)
			continue
		}
		if err := m.r.enable(); err != nil {
			detail := "Bluetooth is not available"
			if offLogged != err.Error() {
				log.Printf("ble: enable: %v", err)
				offLogged = err.Error()
			}
			m.setState(StateOff, detail)
			m.sleep(ctx, m.tm.offRetry)
			continue
		}
		offLogged = ""

		tg := m.targetNow()
		s, path, err := m.connect(ctx, tg)
		if err != nil {
			if ctx.Err() != nil {
				return
			}
			wait := backoff(failures, m.tm.backoffMin, m.tm.backoffMax)
			failures++
			why := "Not found"
			if !errors.Is(err, errNotFound) {
				why = "Could not connect"
			}
			log.Printf("ble: %s: %v; again in %v", describe(tg), err, wait)
			m.setState(StateSearching, fmt.Sprintf("%s, trying again in %s", why, roundWait(wait)))
			m.sleep(ctx, wait)
			continue
		}
		if ctx.Err() != nil {
			// Stop came while the dial was finishing: let go of it at once.
			s.end(false)
			return
		}
		failures = 0
		m.adopt(s, path)
		end := m.hold(ctx, s)
		m.release(s, end)
		switch end {
		case endStop:
			return
		case endLost:
			m.setState(StateSearching, "Connection lost, reconnecting")
			m.sleep(ctx, m.tm.backoffMin)
		case endPower, endTarget:
			// Straight round: the power check or the new target's connect.
		}
	}
}

func roundWait(d time.Duration) string {
	if d < time.Second {
		return d.String()
	}
	return fmt.Sprintf("%d s", int(d.Round(time.Second)/time.Second))
}

func (m *Manager) targetNow() Target {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.target
}

// sleep waits d, or less if ctx ends or SetTarget nudges.
func (m *Manager) sleep(ctx context.Context, d time.Duration) {
	t := time.NewTimer(d)
	defer t.Stop()
	select {
	case <-ctx.Done():
	case <-m.wake:
	case <-t.C:
	}
}

// adopt makes s the connected pedal.
func (m *Manager) adopt(s *session, path connectPath) {
	m.trace.note("connect " + s.dev.Address + " " + s.dev.Name)
	m.mu.Lock()
	m.cur = s
	m.name, m.addr = s.dev.Name, s.dev.Address
	lamps := m.lamps
	fn := m.onConn
	m.mu.Unlock()
	s.start(s.c, lamps)
	log.Printf("ble: connected %s %s", describe(Target{s.dev.Address, s.dev.Name}), path)
	m.setState(StateConnected, "Connected to "+shortName(s.dev.Name))
	if fn != nil {
		fn(s.dev)
	}
}

// hold waits for the connection to end, and says why.
func (m *Manager) hold(ctx context.Context, s *session) holdEnd {
	poll := time.NewTicker(m.tm.powerPoll)
	defer poll.Stop()
	for {
		select {
		case <-ctx.Done():
			return endStop
		case <-s.lost:
			return endLost
		case <-m.wake:
			if tg := m.targetNow(); tg.Address != "" && !strings.EqualFold(tg.Address, s.dev.Address) {
				log.Printf("ble: letting go of %s for %s", describe(Target{s.dev.Address, s.dev.Name}), describe(tg))
				return endTarget
			}
		case <-poll.C:
			// Turning Bluetooth off does not always report the disconnect.
			if on, _ := m.r.power(); !on {
				return endPower
			}
		}
	}
}

// release lets go of s: lamps dark first when the link is still there.
func (m *Manager) release(s *session, end holdEnd) {
	switch end {
	case endLost:
		log.Printf("ble: link dropped (%s)", s.dev.Address)
	case endPower:
		log.Printf("ble: Bluetooth went off")
	}
	s.end(end == endStop || end == endTarget)
	m.trace.note("disconnect " + s.dev.Address)
	m.mu.Lock()
	if m.cur == s {
		m.cur = nil
	}
	m.mu.Unlock()
	m.kick()
}
