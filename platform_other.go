//go:build !darwin && !linux

package main

import (
	"errors"

	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/linux"
)

// The window and shell seams of package main where there is no port yet (Windows).
// docs/PORTING.md has the plan.

// windowPolicy: no tray here, so closing quits and the window always shows.
func windowPolicy(bool) (hideOnClose, startHidden bool) { return false, false }

func singleInstance(*App) *options.SingleInstanceLock { return nil }

func linuxOptions() *linux.Options { return nil }

func revealFile(string) error { return errors.New("revealing files is not supported on this platform") }
