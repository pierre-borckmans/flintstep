//go:build linux && cgo

package coremidi

import (
	"bytes"
	"os"
	"testing"
	"time"
)

// TestALSALoopback creates the two ports, has a second sequencer client subscribe to
// the source and write to the LED port, and checks a message each way. It needs the
// kernel's ALSA sequencer (/dev/snd/seq, module snd-seq); containers and CI VMs often
// lack it, and then the test is skipped.
func TestALSALoopback(t *testing.T) {
	if _, err := os.Stat("/dev/snd/seq"); err != nil {
		t.Skipf("no ALSA sequencer here (%v): load snd-seq to run this test", err)
	}
	got := make(chan []byte, 4)
	v, err := NewVirtual("flintstep-test", "test source", "test LEDs", func(m []byte) { got <- m })
	if err != nil {
		t.Fatal(err)
	}
	defer v.Close()
	p, err := newALSAPeer()
	if err != nil {
		t.Fatal(err)
	}
	defer p.close()
	if err := p.listenTo(v.Client(), int(v.src)); err != nil {
		t.Fatal(err)
	}
	if err := p.sendTo(v.Client(), int(v.dst)); err != nil {
		t.Fatal(err)
	}

	out := []byte{0xB0, 80, 127}
	if err := v.Send(out); err != nil {
		t.Fatal(err)
	}
	if b, err := p.recv(2 * time.Second); err != nil || !bytes.Equal(b, out) {
		t.Fatalf("peer read %x (%v), want %x", b, err, out)
	}

	in := []byte{0x90, 60, 100}
	if err := p.send(in); err != nil {
		t.Fatal(err)
	}
	select {
	case m := <-got:
		if !bytes.Equal(m, in) {
			t.Fatalf("LED port got %x, want %x", m, in)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("nothing arrived on the LED port")
	}

	v.Close()
	if err := v.Send(out); err == nil {
		t.Fatal("Send after Close worked")
	}
}

// Without a sequencer NewVirtual must fail with the explanation, not crash.
func TestNoSequencer(t *testing.T) {
	if _, err := os.Stat("/dev/snd/seq"); err == nil {
		t.Skip("this machine has an ALSA sequencer")
	}
	v, err := NewVirtual("flintstep-test", "s", "d", nil)
	if err == nil {
		v.Close()
		t.Fatal("NewVirtual worked without /dev/snd/seq")
	}
	t.Logf("as expected: %v", err)
}
