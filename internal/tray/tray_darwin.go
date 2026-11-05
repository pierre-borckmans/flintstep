//go:build darwin && cgo

// Package tray is the app's menu bar item: a template icon and a menu the bridge
// rebuilds whenever its state changes. Wails v2 owns NSApp and the main run loop; this
// only adds an NSStatusItem to it, doing every AppKit call on the main queue.
package tray

/*
#cgo CFLAGS: -fobjc-arc
#cgo LDFLAGS: -framework Cocoa
#include "tray_darwin.h"
*/
import "C"

import (
	"strings"
	"sync"
	"time"
	"unsafe"
)

var (
	mu      sync.Mutex
	started bool
	click   func(id string)
)

//export goTrayClick
func goTrayClick(id *C.char) {
	s := C.GoString(id)
	mu.Lock()
	f := click
	mu.Unlock()
	if f != nil {
		// Off the main thread: the handler may well call back into Wails, which
		// dispatches to the main queue synchronously.
		go f(s)
	}
}

// Start puts the item in the menu bar with templateIconPNG as its icon (drawn 18 pt
// high, as a template so macOS tints it) and calls onClick with an item's ID when it
// is chosen, on its own goroutine. Call it once NSApp exists (Wails' OnStartup); later
// calls do nothing.
func Start(templateIconPNG []byte, onClick func(id string)) {
	mu.Lock()
	defer mu.Unlock()
	if started {
		return
	}
	started = true
	click = onClick
	var p unsafe.Pointer
	if len(templateIconPNG) > 0 {
		p = unsafe.Pointer(&templateIconPNG[0])
	}
	C.trayStart(p, C.int(len(templateIconPNG)))
}

// Available reports whether there is a menu bar to put the item in: on macOS always.
func Available(time.Duration) bool { return true }

// SetMenu replaces the item's menu. It may be called before Start; the menu is shown
// once the item exists. Items with an empty ID do nothing when chosen.
func SetMenu(items []Item) {
	if len(items) == 0 {
		C.traySetMenu(nil, 0)
		return
	}
	cs := unsafe.Slice((*C.trayItem)(C.malloc(C.size_t(len(items))*C.size_t(unsafe.Sizeof(C.trayItem{})))), len(items))
	defer C.free(unsafe.Pointer(&cs[0]))
	for i, it := range items {
		var f C.int
		if it.Disabled {
			f |= C.flagDisabled
		}
		if it.Separator {
			f |= C.flagSeparator
		}
		if it.Checked {
			f |= C.flagChecked
		}
		cs[i] = C.trayItem{id: cstr(it.ID), title: cstr(it.Title), flags: f}
	}
	defer func() {
		for _, c := range cs {
			C.free(unsafe.Pointer(c.id))
			C.free(unsafe.Pointer(c.title))
		}
	}()
	C.traySetMenu(&cs[0], C.int(len(cs)))
}

// SetTooltip sets the text shown when the pointer rests on the item.
func SetTooltip(s string) {
	c := cstr(s)
	defer C.free(unsafe.Pointer(c))
	C.traySetTooltip(c)
}

// cstr is s as a C string AppKit will accept: valid UTF-8, no NUL.
func cstr(s string) *C.char {
	s = strings.ToValidUTF8(s, "�")
	s = strings.ReplaceAll(s, "\x00", "")
	return C.CString(s)
}
