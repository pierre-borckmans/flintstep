package platform

import (
	"testing"

	"flintstep/internal/coremidi"
	"flintstep/internal/loginitem"
	"flintstep/internal/tray"
)

// These fail to compile, on whichever GOOS is being built, when a package drops or
// changes a seam. Theme, activation and the window policy are package main's and are
// checked by building package main itself.
var (
	_ MIDIPort                       = (*coremidi.Virtual)(nil)
	_ NewMIDIPort[*coremidi.Virtual] = coremidi.NewVirtual

	_ = Tray{
		Start:      tray.Start,
		SetMenu:    tray.SetMenu,
		SetTooltip: tray.SetTooltip,
		Available:  tray.Available,
	}

	_ = LoginItem{
		Enabled:       loginitem.Enabled,
		Set:           loginitem.Set,
		MigrateLegacy: loginitem.MigrateLegacy,
		Render:        loginitem.Render,
	}
)

func TestSeamsCompile(t *testing.T) {}
