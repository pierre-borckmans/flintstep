//go:build darwin && cgo

// Package coremidi publishes the bridge to other apps as a pair of virtual MIDI
// endpoints: a source the DAW listens to ("Flintstep") and a
// destination it can send LED feedback to ("Flintstep LEDs"). The
// caller picks the names; see internal/product.
//
// A direct binding, like the BEAM Mini app's: a handful of CoreMIDI calls that ship with macOS.
package coremidi

/*
#cgo CFLAGS: -Wno-deprecated-declarations
#cgo LDFLAGS: -framework CoreMIDI -framework CoreFoundation
#include <CoreMIDI/CoreMIDI.h>
#include <CoreFoundation/CoreFoundation.h>
#include <stdint.h>
#include <stdlib.h>

extern void goDestRead(uintptr_t ref, Byte *data, int len);

// destReadProc runs on CoreMIDI's own high-priority thread. MIDIDestinationCreate with
// a C read proc is deprecated since macOS 11 in favour of the block-based MIDI 2.0 call,
// but still supported, and a C function pointer is what cgo can hand over.
static void destReadProc(const MIDIPacketList *pl, void *readRef, void *srcRef) {
	const MIDIPacket *p = &pl->packet[0];
	for (UInt32 i = 0; i < pl->numPackets; i++) {
		goDestRead((uintptr_t)readRef, (Byte *)p->data, (int)p->length);
		p = MIDIPacketNext(p);
	}
}

static CFStringRef cfstr(const char *s) {
	return CFStringCreateWithCString(NULL, s, kCFStringEncodingUTF8);
}

static OSStatus newClient(const char *name, MIDIClientRef *client) {
	CFStringRef n = cfstr(name);
	OSStatus st = MIDIClientCreate(n, NULL, NULL, client);
	CFRelease(n);
	return st;
}

static OSStatus newSource(MIDIClientRef client, const char *name, MIDIEndpointRef *ep) {
	CFStringRef n = cfstr(name);
	OSStatus st = MIDISourceCreate(client, n, ep);
	CFRelease(n);
	return st;
}

static OSStatus newDest(MIDIClientRef client, const char *name, uintptr_t ref, MIDIEndpointRef *ep) {
	CFStringRef n = cfstr(name);
	OSStatus st = MIDIDestinationCreate(client, n, destReadProc, (void *)ref, ep);
	CFRelease(n);
	return st;
}

static OSStatus setStr(MIDIObjectRef o, CFStringRef prop, const char *v) {
	CFStringRef s = cfstr(v);
	OSStatus st = MIDIObjectSetStringProperty(o, prop, s);
	CFRelease(s);
	return st;
}

static OSStatus setUID(MIDIObjectRef o, SInt32 uid) {
	return MIDIObjectSetIntegerProperty(o, kMIDIPropertyUniqueID, uid);
}

// sendMsg wraps one message in a one-packet list stamped "now" and hands it to every
// client listening to the virtual source.
static OSStatus sendMsg(MIDIEndpointRef src, const Byte *data, int len) {
	Byte buf[sizeof(MIDIPacketList) + 512];
	MIDIPacketList *pl = (MIDIPacketList *)buf;
	MIDIPacket *p = MIDIPacketListInit(pl);
	p = MIDIPacketListAdd(pl, sizeof(buf), p, 0, (ByteCount)len, data);
	if (p == NULL) return -50; // paramErr
	return MIDIReceived(src, pl);
}
*/
import "C"

import (
	"errors"
	"fmt"
	"sync"
	"unsafe"

	"flintstep/internal/product"
)

// Manufacturer and Model are what the endpoints report to DAWs, next to their names.
const (
	Manufacturer = product.Name
	Model        = "Footswitch" // not the pedal's model: the ports stay the same for every one
)

// maxMsg bounds Send; channel messages are 3 bytes, the room is for short sysex.
const maxMsg = 256

var errClosed = errors.New("coremidi: closed")

// Virtual is the bridge's pair of virtual endpoints. Send is safe from any goroutine.
type Virtual struct {
	mu     sync.RWMutex // write-held by Close; Send reads
	closed bool
	client C.MIDIClientRef
	src    C.MIDIEndpointRef
	dst    C.MIDIEndpointRef
	ref    uintptr

	p    parser // touched only from the read proc, under destsMu's read lock and pmu
	pmu  sync.Mutex
	in   chan []byte
	done chan struct{}
}

// dests maps the reference CoreMIDI hands back with each packet to its Virtual. The
// read proc holds the read lock while it runs, so Close taking the write lock after the
// destination is disposed waits out a packet in flight: after that, nothing arrives.
var (
	destsMu sync.RWMutex
	dests   = map[uintptr]*Virtual{}
	nextRef uintptr
)

//export goDestRead
func goDestRead(ref C.uintptr_t, data *C.Byte, n C.int) {
	if n <= 0 {
		return
	}
	b := unsafe.Slice((*byte)(unsafe.Pointer(data)), int(n))
	destsMu.RLock()
	defer destsMu.RUnlock()
	v := dests[uintptr(ref)]
	if v == nil {
		return
	}
	v.pmu.Lock()
	v.p.feed(b, func(m []byte) {
		// Never block CoreMIDI's thread: when the consumer is this far behind, drop.
		select {
		case v.in <- m:
		default:
		}
	})
	v.pmu.Unlock()
}

// NewVirtual creates a CoreMIDI client called client with a virtual source and a
// virtual destination. Each endpoint gets a unique ID derived from its name, so it is
// the same on every launch. onDest, if not nil, gets each complete channel message sent
// to the destination, one at a time, on its own goroutine.
func NewVirtual(client, source, dest string, onDest func(msg []byte)) (*Virtual, error) {
	v := &Virtual{in: make(chan []byte, 1024), done: make(chan struct{})}
	cs := C.CString(client)
	defer C.free(unsafe.Pointer(cs))
	if st := C.newClient(cs, &v.client); st != C.noErr {
		return nil, fmt.Errorf("coremidi: cannot create a client (OSStatus %d)", int(st))
	}
	fail := func(what string, st C.OSStatus) (*Virtual, error) {
		C.MIDIClientDispose(v.client) // also disposes of the endpoints created so far
		return nil, fmt.Errorf("coremidi: cannot create the %s (OSStatus %d)", what, int(st))
	}

	ss := C.CString(source)
	defer C.free(unsafe.Pointer(ss))
	if st := C.newSource(v.client, ss, &v.src); st != C.noErr {
		return fail("virtual source", st)
	}
	if st := describe(v.src, source); st != C.noErr {
		return fail("virtual source's properties", st)
	}

	destsMu.Lock()
	nextRef++
	v.ref = nextRef
	dests[v.ref] = v
	destsMu.Unlock()
	ds := C.CString(dest)
	defer C.free(unsafe.Pointer(ds))
	if st := C.newDest(v.client, ds, C.uintptr_t(v.ref), &v.dst); st != C.noErr {
		v.forget()
		return fail("virtual destination", st)
	}
	if st := describe(v.dst, dest); st != C.noErr {
		v.forget()
		return fail("virtual destination's properties", st)
	}

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

// describe gives a fresh endpoint its stable unique ID and its manufacturer and model.
// Another endpoint may hold the ID already (a second copy of the app, or a hash
// collision); the next value is tried then, so a second copy still works.
func describe(ep C.MIDIObjectRef, name string) C.OSStatus {
	uid := stableUID(name)
	for range 16 {
		st := C.setUID(ep, C.SInt32(uid))
		if st == C.noErr {
			break
		}
		if st != C.kMIDIIDNotUnique {
			return st
		}
		uid = nextUID(uid)
	}
	// Past 16 collisions the endpoint keeps the random ID CoreMIDI gave it.
	for _, p := range []struct {
		key C.CFStringRef
		val string
	}{{C.kMIDIPropertyManufacturer, Manufacturer}, {C.kMIDIPropertyModel, Model}} {
		s := C.CString(p.val)
		st := C.setStr(ep, p.key, s)
		C.free(unsafe.Pointer(s))
		if st != C.noErr {
			return st
		}
	}
	return C.noErr
}

func (v *Virtual) forget() {
	destsMu.Lock()
	delete(dests, v.ref)
	destsMu.Unlock()
}

// Send publishes one complete MIDI message on the virtual source.
func (v *Virtual) Send(msg []byte) error {
	if len(msg) == 0 || len(msg) > maxMsg {
		return fmt.Errorf("coremidi: cannot send a %d-byte message", len(msg))
	}
	v.mu.RLock()
	defer v.mu.RUnlock()
	if v.closed {
		return errClosed
	}
	if st := C.sendMsg(v.src, (*C.Byte)(unsafe.Pointer(&msg[0])), C.int(len(msg))); st != C.noErr {
		return fmt.Errorf("coremidi: send failed (OSStatus %d)", int(st))
	}
	return nil
}

// Close removes both endpoints and waits for onDest to return from its last call.
// Calling it again does nothing.
func (v *Virtual) Close() {
	v.mu.Lock()
	if v.closed {
		v.mu.Unlock()
		return
	}
	v.closed = true
	C.MIDIEndpointDispose(v.src)
	C.MIDIEndpointDispose(v.dst)
	C.MIDIClientDispose(v.client)
	v.mu.Unlock()
	v.forget() // waits out a read proc still running
	close(v.in)
	<-v.done
}
