package main

import (
	"sync"
	"time"

	"flintstep/internal/bridge"
	"flintstep/internal/sparkx"
)

// The live trace on each Expression card wants every raw value, not the latest one
// per 20 Hz state push. While the UI watches (WatchExpRaw), the values the bridge feeds
// the engine are batched and sent as an "expraw" event at most every rawEvery.

// rawEvery is the most often an "expraw" event goes out (~60 Hz).
const rawEvery = 16 * time.Millisecond

// rawKeep caps a batch per input: a stalled UI must not grow it without end.
const rawKeep = 256

// RawSample is one raw value and when it came, unix ms.
type RawSample struct {
	At  int64 `json:"t"`
	Raw int   `json:"v"`
}

// ExpRaw is one "expraw" event: each input's values since the last one, oldest first.
type ExpRaw struct {
	Samples [sparkx.ExpInputs][]RawSample `json:"samples"`
}

// ExpWiden is one "expwiden" event: the bridge proposes widening input N's calibrated
// range to Low..High (bridge.Options.OnWiden); the UI applies it if the user lets it.
type ExpWiden struct {
	N    int `json:"n"`
	Low  int `json:"low"`
	High int `json:"high"`
}

type rawStream struct {
	mu    sync.Mutex
	watch bool
	buf   [sparkx.ExpInputs][]RawSample
	kick  chan struct{}
	now   func() time.Time
}

func newRawStream() *rawStream {
	return &rawStream{kick: make(chan struct{}, 1), now: time.Now}
}

// setWatch turns the stream on or off; off drops what was waiting.
func (s *rawStream) setWatch(on bool) {
	s.mu.Lock()
	s.watch = on
	if !on {
		s.buf = [sparkx.ExpInputs][]RawSample{}
	}
	s.mu.Unlock()
}

// add takes one value from the bridge (inside its step: it only appends).
func (s *rawStream) add(n, raw int) {
	if n < 0 || n >= sparkx.ExpInputs {
		return
	}
	s.mu.Lock()
	if !s.watch {
		s.mu.Unlock()
		return
	}
	b := append(s.buf[n], RawSample{At: s.now().UnixMilli(), Raw: raw})
	if len(b) > rawKeep {
		b = b[len(b)-rawKeep:]
	}
	s.buf[n] = b
	s.mu.Unlock()
	select {
	case s.kick <- struct{}{}:
	default:
	}
}

// take empties the batch; ok is false when there was nothing in it.
func (s *rawStream) take() (ExpRaw, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	var ev ExpRaw
	some := false
	for n := range s.buf {
		ev.Samples[n] = s.buf[n]
		if ev.Samples[n] == nil {
			ev.Samples[n] = []RawSample{}
		}
		some = some || len(s.buf[n]) > 0
		s.buf[n] = nil
	}
	return ev, some
}

// loop sends the batches until stop closes.
func (s *rawStream) loop(stop <-chan struct{}, emit func(string, any)) {
	for {
		select {
		case <-stop:
			return
		case <-s.kick:
		}
		if ev, ok := s.take(); ok {
			emit("expraw", ev)
		}
		select {
		case <-stop:
			return
		case <-time.After(rawEvery):
		}
	}
}

// ---- bound methods ----

// WatchExpRaw starts or stops the "expraw" event: the UI watches while an Expression
// card is on screen.
func (a *App) WatchExpRaw(on bool) { a.raw.setWatch(on) }

// StartExpSweep starts calibrating input n by sweeping (bridge.StartExpSweep).
func (a *App) StartExpSweep(n int) error {
	defer a.changed()
	return a.bridge.StartExpSweep(n)
}

// FinishExpSweep ends input n's sweep and returns the heel and toe it calibrates. It
// saves nothing: the UI applies them as one edit, so the change has one history entry
// and one save like any other.
func (a *App) FinishExpSweep(n int) (bridge.SweepResult, error) {
	defer a.changed()
	return a.bridge.FinishExpSweep(n)
}

// CancelExpSweep ends input n's sweep without calibrating.
func (a *App) CancelExpSweep(n int) error {
	defer a.changed()
	return a.bridge.CancelExpSweep(n)
}
