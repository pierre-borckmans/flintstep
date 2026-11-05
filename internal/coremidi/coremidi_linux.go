//go:build linux && cgo

package coremidi

// THE LINUX PORT: an ALSA sequencer client with two ports, the counterpart of the
// CoreMIDI client in coremidi_darwin.go. The package keeps its historical name; on
// Linux it binds libasound (cgo, -lasound; build with libasound2-dev or alsa-lib-devel).
//
// The source port is readable and subscribable ("Flintstep"): every
// message is sent direct to whoever subscribed. The LED port is writable and
// subscribable ("Flintstep LEDs"): a reader goroutine decodes what
// arrives back into MIDI bytes and feeds the same parser CoreMIDI's packets go through.
// PipeWire (with its ALSA sequencer bridge) and JACK (a2jmidid, or Ardour's own ALSA
// backend) show these ports to their clients too.
//
// ALSA has no persistent endpoint ID like kMIDIPropertyUniqueID. Applications find the
// ports again by client and port name, which stay the same across launches.

/*
#cgo pkg-config: alsa
#include <alsa/asoundlib.h>
#include <poll.h>
#include <errno.h>
#include <stdlib.h>
#include <unistd.h>

static int seqOpen(snd_seq_t **seq, const char *client) {
	int err = snd_seq_open(seq, "default", SND_SEQ_OPEN_DUPLEX, SND_SEQ_NONBLOCK);
	if (err < 0) return err;
	err = snd_seq_set_client_name(*seq, client);
	if (err < 0) { snd_seq_close(*seq); return err; }
	return 0;
}

static int newPort(snd_seq_t *seq, const char *name, unsigned int caps) {
	return snd_seq_create_simple_port(seq, name, caps,
		SND_SEQ_PORT_TYPE_MIDI_GENERIC | SND_SEQ_PORT_TYPE_APPLICATION);
}

static unsigned int capsSource(void) { return SND_SEQ_PORT_CAP_READ | SND_SEQ_PORT_CAP_SUBS_READ; }
static unsigned int capsDest(void)   { return SND_SEQ_PORT_CAP_WRITE | SND_SEQ_PORT_CAP_SUBS_WRITE; }

// sendMsg encodes one complete MIDI message as a sequencer event and sends it, direct
// (no queue), to every subscriber of port. The encoder is reset first so running status
// never carries over from the last message.
static int sendMsg(snd_seq_t *seq, snd_midi_event_t *enc, int port, const unsigned char *data, long len) {
	snd_seq_event_t ev;
	snd_midi_event_reset_encode(enc);
	snd_seq_ev_clear(&ev);
	long n = snd_midi_event_encode(enc, data, len, &ev);
	if (n < 0) return (int)n;
	if (ev.type == SND_SEQ_EVENT_NONE) return -EINVAL; // incomplete message
	snd_seq_ev_set_source(&ev, port);
	snd_seq_ev_set_subs(&ev);
	snd_seq_ev_set_direct(&ev);
	int err = snd_seq_event_output_direct(seq, &ev);
	return err < 0 ? err : 0;
}

// waitEvents blocks until the sequencer has input or wakefd becomes readable. It returns
// 1 for input, 0 for a wake-up, a negative errno on failure.
static int waitEvents(snd_seq_t *seq, int wakefd) {
	struct pollfd fds[8];
	int n = snd_seq_poll_descriptors(seq, fds, 7, POLLIN);
	if (n < 0) return n;
	fds[n].fd = wakefd;
	fds[n].events = POLLIN;
	fds[n].revents = 0;
	for (;;) {
		int r = poll(fds, n + 1, -1);
		if (r < 0) {
			if (errno == EINTR) continue;
			return -errno;
		}
		if (fds[n].revents) return 0;
		return 1;
	}
}

// readEvents drains what is waiting (the handle is non-blocking) and decodes each event
// for port into raw MIDI bytes, appended to buf. It returns the number of bytes, or a
// negative errno. Events for other ports and ones with no MIDI form are skipped.
static long readEvents(snd_seq_t *seq, snd_midi_event_t *dec, int port, unsigned char *buf, long cap) {
	long total = 0;
	for (;;) {
		snd_seq_event_t *ev = NULL;
		int err = snd_seq_event_input(seq, &ev);
		if (err == -EAGAIN) break;
		if (err == -ENOSPC) continue; // input overrun: events were lost, carry on
		if (err < 0) return total > 0 ? total : err;
		if (ev == NULL || ev->dest.port != port) continue;
		if (cap - total < 16) break;
		long n = snd_midi_event_decode(dec, buf + total, cap - total, ev);
		if (n > 0) total += n;
	}
	return total;
}

static int clientID(snd_seq_t *seq) { return snd_seq_client_id(seq); }
*/
import "C"

import (
	"errors"
	"fmt"
	"log"
	"os"
	"sync"
	"unsafe"

	"flintstep/internal/product"
)

// Manufacturer and Model are what CoreMIDI shows next to the endpoints. ALSA has no such
// properties; they are kept so the package's API is the same everywhere.
const (
	Manufacturer = product.Name
	Model        = "Footswitch" // not the pedal's model: the ports stay the same for every one
)

// maxMsg bounds Send; channel messages are 3 bytes, the room is for short sysex.
const maxMsg = 256

var errClosed = errors.New("coremidi: closed")

// Virtual is the bridge's pair of ALSA sequencer ports. Send is safe from any goroutine.
type Virtual struct {
	mu     sync.Mutex // serialises output and Close
	closed bool
	seq    *C.snd_seq_t
	enc    *C.snd_midi_event_t
	dec    *C.snd_midi_event_t
	src    C.int
	dst    C.int
	client int

	wakeR, wakeW *os.File // Close writes to wakeW so the reader stops waiting
	p            parser
	in           chan []byte
	readerDone   chan struct{}
	done         chan struct{}
}

// NewVirtual opens an ALSA sequencer client called client with a readable port called
// source and a writable port called dest. onDest, if not nil, gets each complete channel
// message written to dest, one at a time, on its own goroutine.
func NewVirtual(client, source, dest string, onDest func(msg []byte)) (*Virtual, error) {
	v := &Virtual{in: make(chan []byte, 1024), readerDone: make(chan struct{}), done: make(chan struct{})}
	cs := C.CString(client)
	defer C.free(unsafe.Pointer(cs))
	if err := C.seqOpen(&v.seq, cs); err < 0 {
		return nil, openError(int(-err))
	}
	fail := func(what string, err C.int) (*Virtual, error) {
		v.free()
		return nil, fmt.Errorf("coremidi: cannot create the %s: %s", what, alsaErr(err))
	}
	ss := C.CString(source)
	defer C.free(unsafe.Pointer(ss))
	if v.src = C.newPort(v.seq, ss, C.capsSource()); v.src < 0 {
		return fail("source port", v.src)
	}
	ds := C.CString(dest)
	defer C.free(unsafe.Pointer(ds))
	if v.dst = C.newPort(v.seq, ds, C.capsDest()); v.dst < 0 {
		return fail("LED port", v.dst)
	}
	if err := C.snd_midi_event_new(maxMsg, &v.enc); err < 0 {
		return fail("MIDI encoder", err)
	}
	if err := C.snd_midi_event_new(maxMsg, &v.dec); err < 0 {
		return fail("MIDI decoder", err)
	}
	C.snd_midi_event_no_status(v.dec, 1) // every decoded message carries its status byte
	r, w, err := os.Pipe()
	if err != nil {
		v.free()
		return nil, fmt.Errorf("coremidi: %w", err)
	}
	v.wakeR, v.wakeW = r, w
	v.client = int(C.clientID(v.seq))
	log.Printf("midi: ALSA sequencer client %d, ports %d:%d (source) and %d:%d (LEDs)", v.client, v.client, int(v.src), v.client, int(v.dst))

	go v.read()
	go func() {
		defer close(v.done)
		for m := range v.in {
			if onDest != nil {
				onDest(m)
			}
		}
	}()
	return v, nil
}

// read waits for events on the LED port and passes complete messages on. It never
// blocks on the consumer: when that is this far behind, messages are dropped.
func (v *Virtual) read() {
	defer close(v.readerDone)
	buf := make([]byte, 4096)
	wake := C.int(v.wakeR.Fd())
	for {
		r := C.waitEvents(v.seq, wake)
		if r <= 0 {
			if r < 0 {
				log.Printf("midi: ALSA wait failed: %s", alsaErr(r))
			}
			return
		}
		n := C.readEvents(v.seq, v.dec, v.dst, (*C.uchar)(unsafe.Pointer(&buf[0])), C.long(len(buf)))
		if n < 0 {
			log.Printf("midi: ALSA read failed: %s", alsaErr(C.int(n)))
			return
		}
		v.p.feed(buf[:n], func(m []byte) {
			select {
			case v.in <- m:
			default:
			}
		})
	}
}

// Client is the ALSA client number, for the log and for tests.
func (v *Virtual) Client() int { return v.client }

// Send publishes one complete MIDI message on the source port.
func (v *Virtual) Send(msg []byte) error {
	if len(msg) == 0 || len(msg) > maxMsg {
		return fmt.Errorf("coremidi: cannot send a %d-byte message", len(msg))
	}
	v.mu.Lock()
	defer v.mu.Unlock()
	if v.closed {
		return errClosed
	}
	if err := C.sendMsg(v.seq, v.enc, v.src, (*C.uchar)(unsafe.Pointer(&msg[0])), C.long(len(msg))); err < 0 {
		return fmt.Errorf("coremidi: send failed: %s", alsaErr(err))
	}
	return nil
}

// Close removes both ports and waits for onDest to return from its last call. Calling
// it again does nothing.
func (v *Virtual) Close() {
	v.mu.Lock()
	if v.closed {
		v.mu.Unlock()
		return
	}
	v.closed = true
	v.mu.Unlock()
	_, _ = v.wakeW.Write([]byte{0})
	<-v.readerDone
	v.mu.Lock()
	v.free()
	v.mu.Unlock()
	close(v.in)
	<-v.done
}

// free releases the C side. The reader must have stopped.
func (v *Virtual) free() {
	if v.enc != nil {
		C.snd_midi_event_free(v.enc)
		v.enc = nil
	}
	if v.dec != nil {
		C.snd_midi_event_free(v.dec)
		v.dec = nil
	}
	if v.seq != nil {
		C.snd_seq_close(v.seq) // also deletes the ports
		v.seq = nil
	}
	if v.wakeR != nil {
		_ = v.wakeR.Close()
		_ = v.wakeW.Close()
		v.wakeR, v.wakeW = nil, nil
	}
}

func alsaErr(err C.int) string {
	return C.GoString(C.snd_strerror(err))
}
