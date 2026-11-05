package main

import (
	"sync"
	"testing"
	"time"
)

// Values only flow while watched, in order, batched per input.
func TestRawStream(t *testing.T) {
	s := newRawStream()
	at := time.UnixMilli(5000)
	s.now = func() time.Time { return at }
	s.add(0, 10) // not watched: dropped
	if _, ok := s.take(); ok {
		t.Fatal("a value went out unwatched")
	}
	s.setWatch(true)
	s.add(0, 100)
	s.add(1, 200)
	s.add(0, 300)
	s.add(5, 1) // no such input
	ev, ok := s.take()
	if !ok || len(ev.Samples[0]) != 2 || ev.Samples[0][1] != (RawSample{At: 5000, Raw: 300}) ||
		len(ev.Samples[1]) != 1 || ev.Samples[1][0].Raw != 200 {
		t.Fatalf("take = %+v, %v", ev, ok)
	}
	if _, ok := s.take(); ok {
		t.Error("the batch was not emptied")
	}
	for i := range rawKeep + 10 {
		s.add(0, i)
	}
	ev, _ = s.take()
	if len(ev.Samples[0]) != rawKeep || ev.Samples[0][0].Raw != 10 {
		t.Errorf("an overfull batch kept %d from %d", len(ev.Samples[0]), ev.Samples[0][0].Raw)
	}
	s.add(0, 1)
	s.setWatch(false)
	if _, ok := s.take(); ok {
		t.Error("unwatching kept the waiting values")
	}
}

func TestRawStreamLoopEmits(t *testing.T) {
	s := newRawStream()
	s.setWatch(true)
	stop := make(chan struct{})
	got := make(chan ExpRaw, 4)
	var wg sync.WaitGroup
	wg.Add(1)
	go func() {
		defer wg.Done()
		s.loop(stop, func(name string, v any) {
			if name == "expraw" {
				got <- v.(ExpRaw)
			}
		})
	}()
	s.add(1, 42)
	select {
	case ev := <-got:
		if len(ev.Samples[1]) != 1 || ev.Samples[1][0].Raw != 42 {
			t.Errorf("emitted %+v", ev)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("nothing emitted")
	}
	close(stop)
	wg.Wait()
}
