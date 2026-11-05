//go:build darwin

package main

import (
	"os/exec"

	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/linux"
)

// The window and shell seams of package main, macOS side. See internal/platform for the
// list of every per-OS seam.

// windowPolicy: the menu bar is always there, so closing hides and --hidden starts hidden.
func windowPolicy(hidden bool) (hideOnClose, startHidden bool) { return true, hidden }

// singleInstance: none. LaunchServices already brings a running app forward.
func singleInstance(*App) *options.SingleInstanceLock { return nil }

// linuxOptions: not on macOS.
func linuxOptions() *linux.Options { return nil }

// revealFile selects path in Finder.
func revealFile(path string) error { return exec.Command("open", "-R", path).Run() }
