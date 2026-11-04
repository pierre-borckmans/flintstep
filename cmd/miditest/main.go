//go:build darwin && cgo

// Command miditest is a manual check of internal/coremidi and internal/tray on a real
// Mac: it publishes the virtual endpoints, listens to the source and writes to the
// destination from a second CoreMIDI client, and prints what crosses. With -tray it
// also shows the menu bar item for a few seconds.
package main

/*
#cgo CFLAGS: -x objective-c -Wno-deprecated-declarations
#cgo LDFLAGS: -framework CoreMIDI -framework CoreFoundation -framework Cocoa
#import <Cocoa/Cocoa.h>
#include <CoreMIDI/CoreMIDI.h>

extern void goLoopRead(Byte *data, int len);

static void loopReadProc(const MIDIPacketList *pl, void *portRef, void *connRef) {
	const MIDIPacket *p = &pl->packet[0];
	for (UInt32 i = 0; i < pl->numPackets; i++) {
		goLoopRead((Byte *)p->data, (int)p->length);
		p = MIDIPacketNext(p);
	}
}

static MIDIPortRef outPort;
static MIDIEndpointRef destEP;

static int nameIs(MIDIEndpointRef ep, const char *want) {
	CFStringRef s = NULL;
	if (MIDIObjectGetStringProperty(ep, kMIDIPropertyName, &s) != noErr || s == NULL) return 0;
	char buf[256];
	int ok = CFStringGetCString(s, buf, sizeof buf, kCFStringEncodingUTF8) && strcmp(buf, want) == 0;
	CFRelease(s);
	return ok;
}

static SInt32 uidOf(MIDIEndpointRef ep) {
	SInt32 u = 0;
	MIDIObjectGetIntegerProperty(ep, kMIDIPropertyUniqueID, &u);
	return u;
}

// setupLoopback is a second client, as a DAW would be: an input port on the virtual
// source and an output port aimed at the virtual destination.
static OSStatus setupLoopback(const char *src, const char *dst, SInt32 *srcUID, SInt32 *dstUID) {
	MIDIClientRef c;
	MIDIPortRef in;
	OSStatus st = MIDIClientCreate(CFSTR("miditest DAW"), NULL, NULL, &c);
	if (st) return st;
	if ((st = MIDIInputPortCreate(c, CFSTR("in"), loopReadProc, NULL, &in))) return st;
	if ((st = MIDIOutputPortCreate(c, CFSTR("out"), &outPort))) return st;
	for (ItemCount i = 0; i < MIDIGetNumberOfSources(); i++) {
		MIDIEndpointRef ep = MIDIGetSource(i);
		if (nameIs(ep, src)) {
			*srcUID = uidOf(ep);
			if ((st = MIDIPortConnectSource(in, ep, NULL))) return st;
		}
	}
	for (ItemCount i = 0; i < MIDIGetNumberOfDestinations(); i++) {
		MIDIEndpointRef ep = MIDIGetDestination(i);
		if (nameIs(ep, dst)) {
			*dstUID = uidOf(ep);
			destEP = ep;
		}
	}
	return destEP ? noErr : -1;
}

static OSStatus sendToDest(const Byte *data, int len) {
	Byte buf[1024];
	MIDIPacketList *pl = (MIDIPacketList *)buf;
	MIDIPacket *p = MIDIPacketListInit(pl);
	p = MIDIPacketListAdd(pl, sizeof buf, p, 0, len, data);
	return MIDISend(outPort, destEP, pl);
}

static void appInit(void) {
	[NSApplication sharedApplication];
	[NSApp setActivationPolicy:NSApplicationActivationPolicyAccessory];
}

static void appRun(void) { [NSApp run]; }
*/
import "C"

import (
	"flag"
	"fmt"
	"os"
	"runtime"
	"sync"
	"time"
	"unsafe"

	"sparkbridge/internal/coremidi"
	"sparkbridge/internal/tray"
)

func init() { runtime.LockOSThread() } // AppKit wants main() on the main thread

//export goLoopRead
func goLoopRead(data *C.Byte, n C.int) {
	fmt.Printf("loopback <- source: % X\n", C.GoBytes(unsafe.Pointer(data), n))
}

func main() {
	showTray := flag.Bool("tray", false, "show the menu bar item")
	hold := flag.Duration("hold", 2*time.Second, "how long to keep the endpoints up")
	flag.Parse()

	v, err := coremidi.NewVirtual("SparkX MIDI", "Spark Control X", "Spark Control X LEDs", func(m []byte) {
		fmt.Printf("onDest: % X\n", m)
	})
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	defer v.Close()

	src, dst := C.CString("Spark Control X"), C.CString("Spark Control X LEDs")
	var su, du C.SInt32
	if st := C.setupLoopback(src, dst, &su, &du); st != 0 {
		fmt.Fprintln(os.Stderr, "loopback setup failed:", st)
		os.Exit(1)
	}
	fmt.Printf("source uid %d, destination uid %d\n", int32(su), int32(du))

	// Send from several goroutines at once.
	var wg sync.WaitGroup
	for i := range 4 {
		wg.Go(func() {
			if err := v.Send([]byte{0xB0, byte(80 + i), 127}); err != nil {
				fmt.Println("send:", err)
			}
		})
	}
	wg.Wait()
	_ = v.Send([]byte{0x90, 60, 100})
	_ = v.Send([]byte{0x80, 60, 0})
	_ = v.Send([]byte{0xC0, 5})

	// What a DAW might send to the LED destination. CoreMIDI itself re-frames what
	// MIDISend gets (it goes through UMP), so badly formed packets are not passed on as
	// sent; the parser's own tests cover those.
	for _, pk := range [][]byte{
		{0xB0, 80, 127},
		{0x91, 60, 100, 61, 0},               // running status
		{0xF0, 0x7E, 0x7F, 0x06, 0x01, 0xF7}, // sysex: dropped
		{0xF8},                               // clock: dropped
		{0xB0, 81, 64, 0xC1, 3, 0xE0, 0, 64}, // several in one packet
	} {
		if st := C.sendToDest((*C.Byte)(unsafe.Pointer(&pk[0])), C.int(len(pk))); st != 0 {
			fmt.Println("MIDISend:", st)
		}
	}
	time.Sleep(100 * time.Millisecond)

	if *showTray {
		C.appInit()
		tray.SetTooltip("SparkX MIDI (miditest)")
		tray.SetMenu([]tray.Item{
			{Title: "Connected: SparkX test", Disabled: true},
			{Separator: true},
			{ID: "open", Title: "Open SparkX MIDI…"},
			{ID: "login", Title: "Launch at login", Checked: true},
			{Separator: true},
			{ID: "quit", Title: "Quit"},
		})
		tray.Start(tray.Icon, func(id string) {
			fmt.Println("tray click:", id)
			if id == "quit" {
				os.Exit(0)
			}
		})
		go func() {
			time.Sleep(*hold)
			v.Close()
			os.Exit(0)
		}()
		C.appRun()
		return
	}
	time.Sleep(*hold)
}
