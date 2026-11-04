package store

import (
	"encoding/json"
	"fmt"
	"os"
)

// THE APP PREFS FILE: how this Mac shows the app, kept apart from the mapping (presets
// travel between machines; a window theme doesn't). Read once at launch, before the
// window exists, so it never blocks or fails the start: anything wrong is the defaults.

// PrefsFile is the prefs file's name in the data dir.
const PrefsFile = "prefs.json"

// Theme is the window's appearance: follow macOS, or force one.
type Theme string

const (
	ThemeSystem Theme = "system"
	ThemeDark   Theme = "dark"
	ThemeLight  Theme = "light"
)

// ParseTheme reports whether s names a theme.
func ParseTheme(s string) (Theme, bool) {
	switch t := Theme(s); t {
	case ThemeSystem, ThemeDark, ThemeLight:
		return t, true
	}
	return ThemeSystem, false
}

// Prefs is the prefs file.
type Prefs struct {
	Theme Theme `json:"theme"`
}

// DefaultPrefs is a first launch.
func DefaultPrefs() Prefs { return Prefs{Theme: ThemeSystem} }

// LoadPrefs reads the prefs at path. Missing, unreadable or damaged is the defaults;
// an unknown theme is "system".
func LoadPrefs(path string) Prefs {
	p := DefaultPrefs()
	b, err := os.ReadFile(path)
	if err != nil {
		return p
	}
	if json.Unmarshal(b, &p) != nil {
		return DefaultPrefs()
	}
	p.Theme, _ = ParseTheme(string(p.Theme))
	return p
}

// SavePrefs writes p to path atomically.
func SavePrefs(path string, p Prefs) error {
	b, err := json.MarshalIndent(p, "", "  ")
	if err != nil {
		return fmt.Errorf("encoding prefs: %w", err)
	}
	return WriteAtomic(path, append(b, '\n'))
}
