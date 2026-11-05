package main

import (
	"embed"
	"log"
	"os"
	"slices"

	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
	"github.com/wailsapp/wails/v2/pkg/options/mac"

	"flintstep/internal/product"
	"flintstep/internal/store"
)

//go:embed all:frontend/dist
var assets embed.FS

// version is set at build time with -ldflags "-X main.version=...".
var version = "0.1.0"

func main() {
	// --hidden is how the login item starts us: straight to the menu bar, no window.
	hidden := slices.Contains(os.Args[1:], "--hidden")
	app := NewApp()
	// The theme is known before the window exists, so it opens in it.
	if app.prefsFile = prefsPath(); app.prefsFile != "" {
		app.prefs = store.LoadPrefs(app.prefsFile)
	}
	appearance, background := launchLook(app.prefs.Theme, systemIsDark())
	// Hide-on-close needs a tray to come back from; the platform says whether there is one.
	hideOnClose, startHidden := windowPolicy(hidden)

	err := wails.Run(&options.App{
		Title:     product.Name,
		Width:     1180,
		Height:    820,
		MinWidth:  560,
		MinHeight: 560,
		// A menu-bar app: closing the window only hides it. The bridge keeps running and
		// Quit lives in the menu-bar menu.
		HideWindowOnClose: hideOnClose,
		StartHidden:       startHidden,
		AssetServer:       &assetserver.Options{Assets: assets},
		BackgroundColour:  background,
		Mac: &mac.Options{
			// No title bar; the traffic lights stay, inset over the app's own header,
			// which declares the drag region.
			TitleBar:   mac.TitleBarHiddenInset(),
			Appearance: appearance,
			About: &mac.AboutInfo{
				Title:   product.Name,
				Message: "Turns a Spark Control X into a MIDI foot controller.\nNot affiliated with Positive Grid.",
			},
		},
		OnStartup:  app.startup,
		OnShutdown: app.shutdown,
		Bind:       []interface{}{app},

		// Per platform (platform_<os>.go): nil on macOS.
		SingleInstanceLock: singleInstance(app),
		Linux:              linuxOptions(),
	})
	if err != nil {
		log.Println("Error:", err.Error())
	}
}
