package main

import (
	"fmt"
	"log"
	"path/filepath"

	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/mac"

	"flintstep/internal/store"
)

// THE WINDOW THEME. The webview themes itself from CSS; the native window around it (title
// bar, traffic lights, the colour shown before the page paints) is AppKit's, so it is set
// here too. The choice is kept in prefs.json so the window opens in it, with no flash of
// the other theme.

// The window's background in each theme: style.css's --color-bg.
var (
	darkBackground  = options.RGBA{R: 0x14, G: 0x15, B: 0x14, A: 255}
	lightBackground = options.RGBA{R: 0xd9, G: 0xd6, B: 0xcd, A: 255}
)

// launchLook is the appearance and background the window opens with. "system" leaves the
// appearance to macOS and picks the background from whether macOS is dark now.
func launchLook(t store.Theme, systemDark bool) (mac.AppearanceType, *options.RGBA) {
	switch t {
	case store.ThemeDark:
		return mac.NSAppearanceNameDarkAqua, &darkBackground
	case store.ThemeLight:
		return mac.NSAppearanceNameAqua, &lightBackground
	}
	if systemDark {
		return "", &darkBackground
	}
	return "", &lightBackground
}

// prefsPath is where prefs.json lives, or "" with no data dir.
func prefsPath() string {
	dir, err := store.Dir()
	if err != nil {
		return ""
	}
	return filepath.Join(dir, store.PrefsFile)
}

// GetTheme is the theme kept in prefs.json, as loaded at launch or last set. The frontend
// asks for it when its own copy (localStorage) is missing, as on the first launch under a
// new bundle id, so it adopts the saved theme instead of overwriting it with "system".
func (a *App) GetTheme() string {
	a.prefsMu.Lock()
	defer a.prefsMu.Unlock()
	return string(a.prefs.Theme)
}

// SetTheme follows macOS ("system") or forces "dark" or "light": the native window
// switches at once and the choice is kept for the next launch.
func (a *App) SetTheme(mode string) error {
	t, ok := store.ParseTheme(mode)
	if !ok {
		return fmt.Errorf("unknown theme %q", mode)
	}
	a.prefsMu.Lock()
	defer a.prefsMu.Unlock()
	a.applyTheme(t)
	if a.prefs.Theme == t {
		return nil
	}
	a.prefs.Theme = t
	if a.prefsFile == "" {
		return nil
	}
	if err := store.SavePrefs(a.prefsFile, a.prefs); err != nil {
		log.Printf("prefs: %v", err)
		return err
	}
	return nil
}
