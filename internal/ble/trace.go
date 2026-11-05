package ble

import (
	"encoding/hex"
	"fmt"
	"log"
	"time"

	"flintstep/internal/rotlog"
)

// TraceMax is the wire trace's size cap before it rotates to <path>.1. Without the
// expression stream the pedal is quiet: this holds many sessions.
const TraceMax = 4 << 20

// setPath switches the trace to path, closing the previous file. "" turns it off.
func (t *traceFile) setPath(path string) {
	t.mu.Lock()
	defer t.mu.Unlock()
	if path == t.path {
		return
	}
	if t.w != nil {
		_ = t.w.Close()
		t.w = nil
	}
	t.path = path
	if path == "" {
		return
	}
	f, err := rotlog.Open(path, TraceMax)
	if err != nil {
		log.Printf("ble: wire trace off, cannot open %s: %v", path, err)
		return
	}
	t.w = f
}

// line writes one trace line: time, direction (RX/TX/--), what, and the bytes in hex.
// Safe from CoreBluetooth's thread.
func (t *traceFile) line(dir, what string, raw []byte) {
	t.mu.Lock()
	defer t.mu.Unlock()
	if t.w == nil {
		return
	}
	_, _ = fmt.Fprintf(t.w, "%s %s %-3s %s\n", time.Now().Format("15:04:05.000"), dir, what, hex.EncodeToString(raw))
}

// note writes a marker line, such as a connect.
func (t *traceFile) note(s string) {
	t.mu.Lock()
	defer t.mu.Unlock()
	if t.w == nil {
		return
	}
	_, _ = fmt.Fprintf(t.w, "%s -- %s\n", time.Now().Format("15:04:05.000"), s)
}
