package store

import (
	"os"
	"path/filepath"
	"testing"
)

func TestLoadPrefs(t *testing.T) {
	cases := []struct {
		name    string
		content *string
		want    Theme
	}{
		{"missing file is system", nil, ThemeSystem},
		{"damaged file is system", ptr("{nope"), ThemeSystem},
		{"empty object is system", ptr("{}"), ThemeSystem},
		{"unknown theme is system", ptr(`{"theme":"sepia"}`), ThemeSystem},
		{"light", ptr(`{"theme":"light"}`), ThemeLight},
		{"dark", ptr(`{"theme":"dark"}`), ThemeDark},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			path := filepath.Join(t.TempDir(), PrefsFile)
			if c.content != nil {
				if err := os.WriteFile(path, []byte(*c.content), 0o644); err != nil {
					t.Fatal(err)
				}
			}
			if got := LoadPrefs(path).Theme; got != c.want {
				t.Fatalf("theme = %q, want %q", got, c.want)
			}
		})
	}
}

func TestSavePrefsRoundTrip(t *testing.T) {
	path := filepath.Join(t.TempDir(), "sub", PrefsFile)
	if err := SavePrefs(path, Prefs{Theme: ThemeLight}); err != nil {
		t.Fatal(err)
	}
	if got := LoadPrefs(path).Theme; got != ThemeLight {
		t.Fatalf("theme = %q after save", got)
	}
}

func TestParseTheme(t *testing.T) {
	for _, s := range []string{"system", "dark", "light"} {
		if got, ok := ParseTheme(s); !ok || string(got) != s {
			t.Fatalf("ParseTheme(%q) = %q, %v", s, got, ok)
		}
	}
	if got, ok := ParseTheme("Dark"); ok || got != ThemeSystem {
		t.Fatalf("ParseTheme(Dark) = %q, %v", got, ok)
	}
}
