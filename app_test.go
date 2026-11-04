package main

import (
	"context"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

// Wails calls OnShutdown after it has released the window. Bridge activity (the
// releases Stop sends) and the state loop keep emitting from their own goroutines; once
// shutdown has begun none of that may reach Wails.
func TestNoEventsAfterShutdown(t *testing.T) {
	a := NewApp()
	var n atomic.Int64
	a.emitTo = func(string, any) { n.Add(1) }

	stop := make(chan struct{})
	var wg sync.WaitGroup
	for range 4 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for {
				select {
				case <-stop:
					return
				default:
					a.emit("activity", nil)
				}
			}
		}()
	}
	time.Sleep(10 * time.Millisecond)
	a.shutdown(context.Background())
	after := n.Load()
	time.Sleep(20 * time.Millisecond)
	close(stop)
	wg.Wait()
	if late := n.Load() - after; late != 0 {
		t.Errorf("%d events emitted after shutdown", late)
	}
}
