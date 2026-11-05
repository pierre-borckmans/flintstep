//go:build linux

package main

import (
	"log"
	"os"
	"strings"
	"sync"

	"github.com/godbus/dbus/v5"

	"flintstep/internal/store"
)

// THE WINDOW THEME ON LINUX. There is no NSAppearance: a GTK window is dark when GTK is
// asked to prefer its theme's dark variant, and WebKitGTK answers prefers-color-scheme
// from the same setting. So "dark" and "light" set gtk-application-prefer-dark-theme
// (theme_linux_gtk.go), and "system" sets it from the desktop's own choice, read from the
// XDG desktop portal (org.freedesktop.appearance color-scheme, which GNOME 42+, KDE
// Plasma 5.24+ and others publish) and followed live through its SettingChanged
// signal. Without a portal, GTK_THEME decides, and failing that nothing is changed.
// Checked in a container only (Xvfb, no portal); the desktops themselves are untested.

const (
	portalName      = "org.freedesktop.portal.Desktop"
	portalPath      = "/org/freedesktop/portal/desktop"
	portalSettings  = "org.freedesktop.portal.Settings"
	appearanceNS    = "org.freedesktop.appearance"
	colorSchemeName = "color-scheme"
)

var linuxTheme struct {
	mu       sync.Mutex
	theme    store.Theme
	watching bool
}

// setNativeTheme applies t to GTK, and for "system" keeps following the desktop.
func setNativeTheme(t store.Theme) {
	linuxTheme.mu.Lock()
	linuxTheme.theme = t
	startWatch := t == store.ThemeSystem && !linuxTheme.watching
	if startWatch {
		linuxTheme.watching = true
	}
	linuxTheme.mu.Unlock()
	switch t {
	case store.ThemeDark:
		setGtkPreferDark(true)
	case store.ThemeLight:
		setGtkPreferDark(false)
	default:
		if dark, ok := desktopIsDark(); ok {
			setGtkPreferDark(dark)
		}
	}
	if startWatch {
		go watchColorScheme()
	}
}

// systemIsDark reports whether the desktop prefers dark, light when it cannot tell (the
// stock look of most Linux desktops).
func systemIsDark() bool {
	dark, _ := desktopIsDark()
	return dark
}

// desktopIsDark asks the portal, then GTK_THEME. ok is false when neither says.
func desktopIsDark() (dark, ok bool) {
	if c, err := dbus.ConnectSessionBus(); err == nil {
		defer func() { _ = c.Close() }()
		var v dbus.Variant
		obj := c.Object(portalName, portalPath)
		err := obj.Call(portalSettings+".ReadOne", 0, appearanceNS, colorSchemeName).Store(&v)
		if err != nil { // portals before version 2 only have Read, which wraps the value once more
			err = obj.Call(portalSettings+".Read", 0, appearanceNS, colorSchemeName).Store(&v)
		}
		if err == nil {
			if dark, ok := colorScheme(v); ok {
				return dark, true
			}
		}
	}
	return gtkThemeIsDark(os.Getenv("GTK_THEME"))
}

// colorScheme reads the portal's color-scheme value: 1 prefers dark, 2 prefers light,
// 0 has no preference (ok false). The value may come wrapped in variants.
func colorScheme(v dbus.Variant) (dark, ok bool) {
	val := v.Value()
	for {
		inner, isVariant := val.(dbus.Variant)
		if !isVariant {
			break
		}
		val = inner.Value()
	}
	var n uint32
	switch x := val.(type) {
	case uint32:
		n = x
	case int32:
		n = uint32(x)
	default:
		return false, false
	}
	switch n {
	case 1:
		return true, true
	case 2:
		return false, true
	}
	return false, false
}

// gtkThemeIsDark reads GTK_THEME ("Adwaita:dark", "Yaru-dark"); ok is false when unset.
func gtkThemeIsDark(env string) (dark, ok bool) {
	if env == "" {
		return false, false
	}
	l := strings.ToLower(env)
	return strings.HasSuffix(l, ":dark") || strings.HasSuffix(l, "-dark"), true
}

// watchColorScheme follows the portal's SettingChanged for as long as the app runs,
// re-applying the desktop's choice while the theme is "system".
func watchColorScheme() {
	c, err := dbus.ConnectSessionBus()
	if err != nil {
		return
	}
	err = c.AddMatchSignal(dbus.WithMatchObjectPath(portalPath), dbus.WithMatchInterface(portalSettings), dbus.WithMatchMember("SettingChanged"))
	if err != nil {
		log.Printf("theme: cannot follow the desktop's colour scheme: %v", err)
		_ = c.Close()
		return
	}
	ch := make(chan *dbus.Signal, 8)
	c.Signal(ch)
	for sig := range ch {
		if len(sig.Body) < 3 {
			continue
		}
		ns, _ := sig.Body[0].(string)
		key, _ := sig.Body[1].(string)
		v, _ := sig.Body[2].(dbus.Variant)
		if ns != appearanceNS || key != colorSchemeName {
			continue
		}
		linuxTheme.mu.Lock()
		system := linuxTheme.theme == store.ThemeSystem
		linuxTheme.mu.Unlock()
		if !system {
			continue
		}
		dark, ok := colorScheme(v)
		if !ok {
			dark, _ = gtkThemeIsDark(os.Getenv("GTK_THEME"))
		}
		setGtkPreferDark(dark)
	}
}
