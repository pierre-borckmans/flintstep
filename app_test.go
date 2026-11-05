package main

import (
	"context"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"flintstep/internal/ble"
	"flintstep/internal/mapping"
	"flintstep/internal/sparkx"
)

// The menu says which model it is connected to, and what it looks for.
func TestStatusLine(t *testing.T) {
	rc := sparkx.ReactorControl.Info()
	for _, c := range []struct {
		st   ble.Status
		want string
	}{
		{ble.Status{State: ble.StateConnected, Name: "REACTOR Control 7f", Model: rc}, "Connected to REACTOR Control"},
		{ble.Status{State: ble.StateConnected, Name: "SparkX v4", Model: sparkx.SparkControlX.Info()}, "Connected to Spark Control X"},
		{ble.Status{State: ble.StateConnected, Name: "AT-FS6", Model: sparkx.Compatible.Info()}, "Connected to AT-FS6"},
		{ble.Status{State: ble.StateSearching}, "Looking for your pedal…"},
		{ble.Status{State: ble.StateSearching, Name: "REACTOR Control 7f", Model: rc}, "Looking for REACTOR Control…"},
		{ble.Status{State: ble.StateConnecting, Name: "Mystery"}, "Connecting to Mystery…"},
		{ble.Status{State: ble.StateOff, Detail: "Bluetooth is off"}, "Bluetooth is off"},
		{ble.Status{State: ble.StateIdle}, "Not connected"},
	} {
		if got := statusLine(c.st); got != c.want {
			t.Errorf("statusLine(%+v) = %q, want %q", c.st, got, c.want)
		}
	}
}

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

func TestShouldRemember(t *testing.T) {
	a := ble.Device{Address: "aaaa", Name: "SparkX v4.1.23 fbfc"}
	cases := []struct {
		name  string
		saved mapping.PedalRef
		d     ble.Device
		want  bool
	}{
		{"nothing saved: first found", mapping.PedalRef{}, a, true},
		{"already saved", mapping.PedalRef{Address: "aaaa", Name: a.Name}, a, false},
		{"same pedal, new identifier", mapping.PedalRef{Address: "old", Name: a.Name}, a, true},
		{"same identifier, name changed", mapping.PedalRef{Address: "aaaa", Name: "SparkX v4.1.22 fbfc"}, a, true},
		{"user chose another pedal mid-dial", mapping.PedalRef{Address: "bbbb", Name: "SparkX v4.1.23 0001"}, a, false},
	}
	for _, c := range cases {
		if got := shouldRemember(c.saved, c.d); got != c.want {
			t.Errorf("%s: shouldRemember = %v, want %v", c.name, got, c.want)
		}
	}
}

func TestBatteryLine(t *testing.T) {
	st := func(level int, powered bool) ble.Status {
		s := ble.Status{State: ble.StateConnected}
		s.Battery, s.Powered = level, powered
		return s
	}
	cases := []struct {
		st   ble.Status
		want string
	}{
		{st(30, true), "Battery 30% · charging"},
		{st(100, true), "Battery 100% · charging"},
		{st(61, false), "Battery 61%"},
		{st(30, false), "Battery 30%"},
		{st(-1, true), ""},
		{ble.Status{State: ble.StateSearching}, ""},
	}
	for _, c := range cases {
		if got := batteryLine(c.st); got != c.want {
			t.Errorf("batteryLine(%d%%, powered %v) = %q, want %q", c.st.Battery, c.st.Powered, got, c.want)
		}
	}
}
