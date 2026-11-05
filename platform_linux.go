//go:build linux

package main

import (
	_ "embed"
	"log"
	"os/exec"
	"path/filepath"
	"time"

	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/linux"

	"flintstep/internal/product"
	"flintstep/internal/tray"
)

// The window and shell seams of package main, Linux side.

//go:embed build/appicon.png
var windowIcon []byte

// programName is the WM_CLASS the window gets, matching StartupWMClass in
// build/linux/flintstep.desktop so the dock groups the window under the app's icon.
const programName = "flintstep"

// trayWaitHidden is how long a login start waits for the desktop's tray host: the
// session may start autostart entries before the panel.
const trayWaitHidden = 10 * time.Second

// windowPolicy decides whether closing the window hides it. Only when a tray host is
// there (Available): on a desktop without one (stock GNOME) a hidden window could never
// be shown again, so closing quits, and --hidden opens the window after all.
func windowPolicy(hidden bool) (hideOnClose, startHidden bool) {
	wait := time.Duration(0)
	if hidden {
		wait = trayWaitHidden
	}
	if !tray.Available(wait) {
		log.Printf("no tray host on this desktop (StatusNotifierWatcher): closing the window quits %s", product.Name)
		return false, false
	}
	return true, hidden
}

// singleInstance makes a second launch (the app menu, a double-clicked AppImage) show
// the running copy's window instead of starting another bridge to fight over the pedal.
func singleInstance(a *App) *options.SingleInstanceLock {
	return &options.SingleInstanceLock{
		UniqueId:               product.BundleID,
		OnSecondInstanceLaunch: func(options.SecondInstanceData) { a.showWindow() },
	}
}

func linuxOptions() *linux.Options {
	return &linux.Options{
		Icon:        windowIcon,
		ProgramName: programName,
		// Wails' default when Options is nil; set again here because passing Options at
		// all would otherwise turn it to OnDemand (wails#2977).
		WebviewGpuPolicy: linux.WebviewGpuPolicyNever,
	}
}

// revealFile opens the folder holding path in the file manager.
func revealFile(path string) error {
	return exec.Command("xdg-open", filepath.Dir(path)).Start()
}
