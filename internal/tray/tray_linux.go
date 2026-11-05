//go:build linux

package tray

// THE LINUX TRAY: a StatusNotifierItem (the KDE/freedesktop tray protocol, also what
// Ubuntu's AppIndicator and GNOME's AppIndicator extension show) through fyne.io/systray.
//
// On Linux fyne's systray is pure D-Bus: no GTK, no main thread, no event loop of its
// own. RunWithExternalLoop's start function exports the item on the session bus and
// returns, so it sits next to Wails' GTK main loop without touching it. Menu clicks
// arrive on D-Bus goroutines and are handed to onClick on a goroutine of their own,
// like on macOS.
//
// A desktop without a StatusNotifierWatcher (stock GNOME without the AppIndicator
// extension) shows nothing; Available reports that, and the app then lets the window's
// close button quit instead of hiding into a tray nobody can see.

import (
	_ "embed"
	"sync"
	"time"

	"fyne.io/systray"
	"github.com/godbus/dbus/v5"

	"flintstep/internal/product"
)

// linuxIcon is the colour app icon at 64 px: a tray on Linux is light or dark depending
// on the desktop, and has no template tinting, so the black menu-bar glyph would vanish
// on a dark panel. Made from build/appicon.png with `sips -Z 64`.
//
//go:embed icon_linux.png
var linuxIcon []byte

var (
	mu      sync.Mutex
	started bool
	click   func(id string)
	shown   []Item              // the menu as built
	entries []*systray.MenuItem // one per item of shown; nil for separators
	stop    chan struct{}       // closed when the menu is rebuilt: ends its click readers
	want    []Item              // the menu asked for before Start
	tip     string
)

// Start puts the item in the tray and calls onClick with an item's ID when it is
// chosen, on its own goroutine. The icon argument (the macOS template glyph) is not
// used: Linux trays get the colour app icon. Later calls do nothing.
func Start(_ []byte, onClick func(id string)) {
	mu.Lock()
	defer mu.Unlock()
	if started {
		return
	}
	started = true
	click = onClick
	start, _ := systray.RunWithExternalLoop(nil, nil)
	start()
	systray.SetIcon(linuxIcon)
	systray.SetTitle(product.Name)
	if tip != "" {
		systray.SetTooltip(tip)
	}
	// A left click (KDE's "Activate") opens the window; the menu is on the right button.
	systray.SetOnTapped(func() { emit("open") })
	apply(want)
}

func emit(id string) {
	mu.Lock()
	f := click
	mu.Unlock()
	if f != nil && id != "" {
		go f(id)
	}
}

// SetMenu replaces the item's menu. It may be called before Start; the menu is shown
// once the item exists. Items with an empty ID do nothing when chosen.
func SetMenu(items []Item) {
	mu.Lock()
	defer mu.Unlock()
	items = append([]Item(nil), items...)
	if !started {
		want = items
		return
	}
	apply(items)
}

// apply brings the shown menu to items with the least work. mu is held.
func apply(items []Item) {
	switch planMenu(shown, items) {
	case planNothing:
		return
	case planUpdate:
		for i, it := range items {
			e := entries[i]
			if e == nil {
				continue
			}
			if it.Title != shown[i].Title {
				e.SetTitle(it.Title)
			}
			if it.Disabled != shown[i].Disabled {
				if it.Disabled {
					e.Disable()
				} else {
					e.Enable()
				}
			}
		}
		shown = items
		return
	}
	if stop != nil {
		close(stop)
	}
	systray.ResetMenu()
	stop = make(chan struct{})
	entries = make([]*systray.MenuItem, len(items))
	for i, it := range items {
		if it.Separator {
			systray.AddSeparator()
			continue
		}
		var e *systray.MenuItem
		if it.Checked {
			e = systray.AddMenuItemCheckbox(it.Title, "", true)
		} else {
			e = systray.AddMenuItem(it.Title, "")
		}
		if it.Disabled {
			e.Disable()
		}
		entries[i] = e
		go readClicks(e, it.ID, stop)
	}
	shown = items
}

func readClicks(e *systray.MenuItem, id string, stop <-chan struct{}) {
	for {
		select {
		case <-stop:
			return
		case <-e.ClickedCh:
			emit(id)
		}
	}
}

// SetTooltip sets the text shown when the pointer rests on the item.
func SetTooltip(s string) {
	mu.Lock()
	defer mu.Unlock()
	if s == tip {
		return
	}
	tip = s
	if started {
		systray.SetTooltip(s)
	}
}

// watcher is the session bus name a StatusNotifierItem host owns.
const watcher = "org.kde.StatusNotifierWatcher"

// Available reports whether the desktop shows tray items: whether anyone owns the
// StatusNotifierWatcher name on the session bus. It waits up to wait for one to turn up,
// which matters at login, when the app may start before the panel does.
func Available(wait time.Duration) bool {
	c, err := dbus.ConnectSessionBus()
	if err != nil {
		return false
	}
	defer func() { _ = c.Close() }()
	deadline := time.Now().Add(wait)
	for {
		var has bool
		err := c.BusObject().Call("org.freedesktop.DBus.NameHasOwner", 0, watcher).Store(&has)
		if err == nil && has {
			return true
		}
		if time.Now().After(deadline) {
			return false
		}
		time.Sleep(250 * time.Millisecond)
	}
}
