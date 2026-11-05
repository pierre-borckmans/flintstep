//go:build linux && cgo

package coremidi

// alsaPeer is a second ALSA sequencer client for the integration test
// (coremidi_linux_test.go), standing in for a DAW: it subscribes to the source and
// writes to the LED port. It lives outside the _test file because cgo is not allowed
// in tests.

/*
#cgo pkg-config: alsa
#include <alsa/asoundlib.h>
#include <poll.h>

static int peerOpen(snd_seq_t **seq, int *port) {
	int err = snd_seq_open(seq, "default", SND_SEQ_OPEN_DUPLEX, 0);
	if (err < 0) return err;
	snd_seq_set_client_name(*seq, "flintstep-test-peer");
	*port = snd_seq_create_simple_port(*seq, "peer",
		SND_SEQ_PORT_CAP_READ | SND_SEQ_PORT_CAP_SUBS_READ | SND_SEQ_PORT_CAP_WRITE | SND_SEQ_PORT_CAP_SUBS_WRITE,
		SND_SEQ_PORT_TYPE_MIDI_GENERIC | SND_SEQ_PORT_TYPE_APPLICATION);
	return *port < 0 ? *port : 0;
}

static int peerSend(snd_seq_t *seq, int port, const unsigned char *data, long len) {
	snd_midi_event_t *enc;
	int err = snd_midi_event_new(64, &enc);
	if (err < 0) return err;
	snd_seq_event_t ev;
	snd_seq_ev_clear(&ev);
	long n = snd_midi_event_encode(enc, data, len, &ev);
	snd_midi_event_free(enc);
	if (n < 0) return (int)n;
	snd_seq_ev_set_source(&ev, port);
	snd_seq_ev_set_subs(&ev);
	snd_seq_ev_set_direct(&ev);
	err = snd_seq_event_output_direct(seq, &ev);
	return err < 0 ? err : 0;
}

// peerRecv waits up to ms for one event and decodes it; returns the byte count, 0 on
// timeout, or a negative errno.
static long peerRecv(snd_seq_t *seq, unsigned char *buf, long cap, int ms) {
	struct pollfd fds[4];
	int n = snd_seq_poll_descriptors(seq, fds, 4, POLLIN);
	if (poll(fds, n, ms) <= 0) return 0;
	snd_seq_event_t *ev = NULL;
	int err = snd_seq_event_input(seq, &ev);
	if (err < 0) return err;
	snd_midi_event_t *dec;
	err = snd_midi_event_new(64, &dec);
	if (err < 0) return err;
	snd_midi_event_no_status(dec, 1);
	long got = snd_midi_event_decode(dec, buf, cap, ev);
	snd_midi_event_free(dec);
	return got;
}
*/
import "C"

import (
	"fmt"
	"time"
	"unsafe"
)

type alsaPeer struct {
	seq  *C.snd_seq_t
	port C.int
}

func newALSAPeer() (*alsaPeer, error) {
	p := &alsaPeer{}
	if err := C.peerOpen(&p.seq, &p.port); err < 0 {
		return nil, fmt.Errorf("peer: %s", alsaErr(err))
	}
	return p, nil
}

// listenTo subscribes the peer to client:port (our source).
func (p *alsaPeer) listenTo(client, port int) error {
	if err := C.snd_seq_connect_from(p.seq, p.port, C.int(client), C.int(port)); err < 0 {
		return fmt.Errorf("peer: connect from %d:%d: %s", client, port, alsaErr(err))
	}
	return nil
}

// sendTo subscribes client:port (our LED port) to the peer's output.
func (p *alsaPeer) sendTo(client, port int) error {
	if err := C.snd_seq_connect_to(p.seq, p.port, C.int(client), C.int(port)); err < 0 {
		return fmt.Errorf("peer: connect to %d:%d: %s", client, port, alsaErr(err))
	}
	return nil
}

func (p *alsaPeer) send(msg []byte) error {
	if err := C.peerSend(p.seq, p.port, (*C.uchar)(unsafe.Pointer(&msg[0])), C.long(len(msg))); err < 0 {
		return fmt.Errorf("peer: send: %s", alsaErr(err))
	}
	return nil
}

func (p *alsaPeer) recv(wait time.Duration) ([]byte, error) {
	buf := make([]byte, 64)
	n := C.peerRecv(p.seq, (*C.uchar)(unsafe.Pointer(&buf[0])), C.long(len(buf)), C.int(wait.Milliseconds()))
	if n < 0 {
		return nil, fmt.Errorf("peer: recv: %s", alsaErr(C.int(n)))
	}
	return buf[:n], nil
}

func (p *alsaPeer) close() { C.snd_seq_close(p.seq) }
