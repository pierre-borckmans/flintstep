package main

import (
	"path/filepath"
	"testing"

	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/mac"

	"flintstep/internal/store"
)

func TestLaunchLook(t *testing.T) {
	cases := []struct {
		theme      store.Theme
		systemDark bool
		appearance mac.AppearanceType
		background options.RGBA
	}{
		{store.ThemeDark, false, mac.NSAppearanceNameDarkAqua, options.RGBA{R: 0x14, G: 0x15, B: 0x14, A: 255}},
		{store.ThemeLight, true, mac.NSAppearanceNameAqua, options.RGBA{R: 0xd9, G: 0xd6, B: 0xcd, A: 255}},
		{store.ThemeSystem, true, "", options.RGBA{R: 0x14, G: 0x15, B: 0x14, A: 255}},
		{store.ThemeSystem, false, "", options.RGBA{R: 0xd9, G: 0xd6, B: 0xcd, A: 255}},
	}
	for _, c := range cases {
		app, bg := launchLook(c.theme, c.systemDark)
		if app != c.appearance || *bg != c.background {
			t.Errorf("launchLook(%s, dark=%v) = %q %+v", c.theme, c.systemDark, app, *bg)
		}
	}
}

func TestSetTheme(t *testing.T) {
	a := NewApp()
	a.prefsFile = filepath.Join(t.TempDir(), store.PrefsFile)
	var applied []store.Theme
	a.applyTheme = func(th store.Theme) { applied = append(applied, th) }

	if err := a.SetTheme("light"); err != nil {
		t.Fatal(err)
	}
	if got := store.LoadPrefs(a.prefsFile).Theme; got != store.ThemeLight {
		t.Fatalf("saved theme = %q", got)
	}
	// The frontend repeats the theme on every load: the window is told again, no harm.
	if err := a.SetTheme("light"); err != nil {
		t.Fatal(err)
	}
	if err := a.SetTheme("sepia"); err == nil {
		t.Fatal("unknown theme accepted")
	}
	if len(applied) != 2 || applied[0] != store.ThemeLight || applied[1] != store.ThemeLight {
		t.Fatalf("applied = %v", applied)
	}
	if store.LoadPrefs(a.prefsFile).Theme != store.ThemeLight {
		t.Fatal("a rejected theme changed the saved one")
	}
}

func TestSetThemeWithoutDataDir(t *testing.T) {
	a := NewApp()
	a.applyTheme = func(store.Theme) {}
	if err := a.SetTheme("dark"); err != nil {
		t.Fatal(err)
	}
	if a.prefs.Theme != store.ThemeDark {
		t.Fatalf("theme = %q", a.prefs.Theme)
	}
}

func TestGetTheme(t *testing.T) {
	path := filepath.Join(t.TempDir(), store.PrefsFile)
	if err := store.SavePrefs(path, store.Prefs{Theme: store.ThemeLight}); err != nil {
		t.Fatal(err)
	}
	// As main does: prefs.json is read before the window exists.
	a := NewApp()
	a.applyTheme = func(store.Theme) {}
	a.prefsFile = path
	a.prefs = store.LoadPrefs(path)
	if got := a.GetTheme(); got != "light" {
		t.Fatalf("GetTheme = %q, want the saved light", got)
	}
	if err := a.SetTheme("dark"); err != nil {
		t.Fatal(err)
	}
	if got := a.GetTheme(); got != "dark" {
		t.Fatalf("GetTheme after SetTheme = %q", got)
	}
	if got := NewApp().GetTheme(); got != "system" {
		t.Fatalf("GetTheme with no prefs = %q", got)
	}
}
