//go:build linux

package main

import (
	"testing"

	"github.com/godbus/dbus/v5"
)

func TestColorScheme(t *testing.T) {
	for _, c := range []struct {
		name     string
		v        dbus.Variant
		dark, ok bool
	}{
		{"dark", dbus.MakeVariant(uint32(1)), true, true},
		{"light", dbus.MakeVariant(uint32(2)), false, true},
		{"no preference", dbus.MakeVariant(uint32(0)), false, false},
		{"Read's double wrap", dbus.MakeVariant(dbus.MakeVariant(uint32(1))), true, true},
		{"int32", dbus.MakeVariant(int32(2)), false, true},
		{"junk", dbus.MakeVariant("dark"), false, false},
	} {
		dark, ok := colorScheme(c.v)
		if dark != c.dark || ok != c.ok {
			t.Errorf("%s: got %v %v, want %v %v", c.name, dark, ok, c.dark, c.ok)
		}
	}
}

func TestGtkThemeIsDark(t *testing.T) {
	for env, want := range map[string][2]bool{
		"":             {false, false},
		"Adwaita":      {false, true},
		"Adwaita:dark": {true, true},
		"Yaru-dark":    {true, true},
		"Arc-Darker":   {false, true},
	} {
		dark, ok := gtkThemeIsDark(env)
		if dark != want[0] || ok != want[1] {
			t.Errorf("%q: got %v %v, want %v", env, dark, ok, want)
		}
	}
}
