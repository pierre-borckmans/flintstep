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
