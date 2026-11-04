package ble

import (
	"fmt"
	"log"
	"sync"
	"time"

	"sparkbridge/internal/sparkx"
)

// ONE CONNECTED SPARK CONTROL X.
//
// Lifted from Beam's sparkx_ble.go, which was verified on hardware. The switches
// notify a bitmask, FFCA notifies everything else (sparkx.ParseMsg), and FFC9 takes
// our requests and lamp messages.
//
// Writes to FFC9 are with response and tinygo allows one in flight per
// characteristic, so a single writer goroutine does all of them: the info requests,
// the battery poll, and the lamps, which it brings to the wanted state whenever they
// change. Only lamps that changed are written (sparkx.LampSet), so SetLamps can be
// called as often as the caller likes.
//
// All eight lamps are the caller's, the Amp and App lamps included: what they show is
// the user's choice (mapping.Indicator). The session only darkens them on a hang-up.

// session is one connected pedal. It is a sink before the dial returns (notifications
// can arrive during setup) and gets its conn with start.
type session struct {
	m   *Manager
	dev Device
	c   conn

	mu     sync.Mutex
	st     sparkx.Status
	expRaw [sparkx.ExpInputs]int
	held   byte
	scale  *sparkx.ExpScale
	lamps  sparkx.LampSet
	gone   bool // the lamps went dark for a hang-up: no more lamp updates

	reqs     chan []byte
	lampKick chan struct{}
	dark     chan chan struct{}
	done     chan struct{}
	stopOnce sync.Once
	lost     chan struct{}
	lostOnce sync.Once
}

func newSession(m *Manager, dev Device) *session {
	s := &session{
		m:        m,
		dev:      dev,
		st:       sparkx.NewStatus(),
		expRaw:   [sparkx.ExpInputs]int{-1, -1},
		scale:    sparkx.NewExpScale(),
		reqs:     make(chan []byte, 16),
		lampKick: make(chan struct{}, 1),
		dark:     make(chan chan struct{}),
		done:     make(chan struct{}),
		lost:     make(chan struct{}),
	}
	// Whatever the last app left lit is unknown: every lamp is written once.
	s.lamps.Forget()
	return s
}

// start runs the writer on c and asks the pedal what it is.
func (s *session) start(c conn, lamps [sparkx.Lamps]sparkx.Colour) {
	s.c = c
	s.mu.Lock()
	for n, col := range lamps {
		s.lamps.Set(n, col)
	}
	s.mu.Unlock()
	go s.writer()
	for _, r := range [][]byte{sparkx.FirmwareRequest(), sparkx.ProfileRequest(), sparkx.BatteryRequest(), sparkx.CablesRequest(), sparkx.PowerRequest()} {
		s.request(r)
	}
	kickChan(s.lampKick)
}

// end hangs up: lamps dark first unless the link is already gone.
func (s *session) end(goDark bool) {
	if goDark {
		s.goDark()
	}
	s.stop()
	if s.c != nil {
		s.c.close()
	}
}

func (s *session) snapshot() (sparkx.Status, [sparkx.ExpInputs]int) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.st, s.expRaw
}

func (s *session) setLamps(l [sparkx.Lamps]sparkx.Colour) {
	s.mu.Lock()
	if s.gone {
		s.mu.Unlock()
		return
	}
	for n, c := range l {
		s.lamps.Set(n, c)
	}
	s.mu.Unlock()
	kickChan(s.lampKick)
}

func kickChan(c chan struct{}) {
	select {
	case c <- struct{}{}:
	default:
	}
}

// request queues one message for FFC9; a full queue drops it.
func (s *session) request(r []byte) {
	select {
	case s.reqs <- r:
	default:
	}
}

// stop ends the writer. Safe to call more than once.
func (s *session) stop() { s.stopOnce.Do(func() { close(s.done) }) }

// goDark turns every lamp off and waits, up to darkWait, for that to be written: a
// pedal the app lets go of should not keep showing the app's state.
func (s *session) goDark() {
	wait := s.m.tm.darkWait
	reply := make(chan struct{})
	select {
	case s.dark <- reply:
	case <-s.done:
		return
	case <-time.After(wait):
		return
	}
	select {
	case <-reply:
	case <-time.After(wait):
	}
}

// writer makes every write to FFC9, one at a time.
func (s *session) writer() {
	poll := time.NewTicker(s.m.tm.batteryPoll)
	defer poll.Stop()
	// LAMPS ARE THE PEDAL'S, NOT OURS. Every host connected to it (macOS, the Spark app,
	// a second copy of this bridge) writes the same eight lamps, and any of them can
	// darken what we lit without us hearing about it. So the lamps are rewritten in
	// full every lampRefresh: sixteen small writes, and a lamp someone else changed is
	// back within seconds.
	refresh := time.NewTicker(s.m.tm.lampRefresh)
	defer refresh.Stop()
	failed := false
	write := func(b []byte) {
		s.m.trace.line("TX", "cmd", b)
		if err := s.c.write(b); err != nil && !failed {
			failed = true // once per connection: a dead link fails every write
			log.Printf("ble: write failed: %v", err)
		}
	}
	flush := func() {
		s.mu.Lock()
		msgs := s.lamps.Flush()
		for n := range s.st.Lamps {
			s.st.Lamps[n] = s.lamps.Want(n)
		}
		s.mu.Unlock()
		for _, m := range msgs {
			write(m)
		}
		if len(msgs) > 0 {
			s.m.kick()
		}
	}
	for {
		select {
		case <-s.done:
			return
		case r := <-s.reqs:
			write(r)
		case <-s.lampKick:
			flush()
		case reply := <-s.dark:
			s.mu.Lock()
			s.gone = true
			for n := 0; n < sparkx.Lamps; n++ {
				s.lamps.Set(n, sparkx.Colour{})
			}
			s.mu.Unlock()
			flush()
			close(reply)
		case <-poll.C:
			write(sparkx.BatteryRequest())
			write(sparkx.PowerRequest())
		case <-refresh.C:
			s.mu.Lock()
			gone := s.gone
			if !gone {
				s.lamps.Forget()
			}
			s.mu.Unlock()
			if !gone {
				flush()
			}
		}
	}
}

// switches runs on CoreBluetooth's thread for each switch notification.
func (s *session) switches(buf []byte) {
	s.m.trace.line("RX", "sw", buf)
	if len(buf) == 0 {
		return
	}
	s.mu.Lock()
	edges := sparkx.Edges(s.held, buf[0])
	s.held = buf[0]
	s.st.Held = int(buf[0] & (1<<sparkx.Switches - 1))
	s.mu.Unlock()
	for _, e := range edges {
		s.m.emit(event{edge: e})
	}
	s.m.kick()
}

// command runs on CoreBluetooth's thread for each FFCA notification.
func (s *session) command(buf []byte) {
	m, ok := sparkx.ParseMsg(buf)
	if !ok || m.Kind != sparkx.MsgExp {
		// The expression stream is left out of the trace: about 60 lines a second, idle.
		s.m.trace.line("RX", "cmd", buf)
	}
	if !ok {
		return
	}
	var exps []event
	note := ""
	s.mu.Lock()
	switch m.Kind {
	case sparkx.MsgExp:
		for n := 0; n < sparkx.ExpInputs; n++ {
			if !s.st.Cables[n] {
				continue // an empty jack reads noise
			}
			s.expRaw[n] = m.Exp[n]
			if v, changed := s.scale.Feed(n, m.Exp[n]); changed {
				s.st.Exp[n] = v
			}
			exps = append(exps, event{exp: true, n: n, raw: m.Exp[n]})
		}
	case sparkx.MsgCables:
		for n := 0; n < sparkx.ExpInputs; n++ {
			in := m.Cables&(1<<n) != 0
			if in != s.st.Cables[n] {
				note += fmt.Sprintf(" exp %d %s", n+1, map[bool]string{true: "plugged", false: "unplugged"}[in])
			}
			s.st.Cables[n] = in
			if !in {
				s.scale.Reset(n)
				s.st.Exp[n], s.expRaw[n] = -1, -1
			}
		}
	case sparkx.MsgBattery:
		s.st.Battery = m.Value
	case sparkx.MsgPower:
		s.st.Powered = m.Value == 1
	case sparkx.MsgFirmware:
		s.st.Firmware = m.Text
		note = " firmware " + m.Text
	case sparkx.MsgProfile:
		s.st.Profile = m.Value
		s.request(sparkx.ProfileNameRequest(m.Value))
	case sparkx.MsgProfileName:
		s.st.ProfileName = m.Text
		note = fmt.Sprintf(" profile %d %q", m.Value, m.Text)
	}
	s.mu.Unlock()
	if note != "" {
		log.Printf("ble:%s", note)
	}
	for _, e := range exps {
		s.m.emit(e)
	}
	if m.Kind != sparkx.MsgProfileCmd && m.Kind != sparkx.MsgOther && m.Kind != sparkx.MsgLayout {
		s.m.kick()
	}
}

// battery takes a reading from the standard Battery Service.
func (s *session) battery(level int) {
	s.mu.Lock()
	s.st.Battery = level
	s.mu.Unlock()
	s.m.kick()
}

// power takes a reading from the USB power characteristic.
func (s *session) power(on bool) {
	s.mu.Lock()
	s.st.Powered = on
	s.mu.Unlock()
	s.m.kick()
}

// dropped runs on CoreBluetooth's thread when the link goes away.
func (s *session) dropped() { s.lostOnce.Do(func() { close(s.lost) }) }
