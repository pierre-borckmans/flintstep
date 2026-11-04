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
)

//go:embed all:frontend/dist
var assets embed.FS

// version is set at build time with -ldflags "-X main.version=...".
var version = "0.1.0"

func main() {
	// --hidden is how the login item starts us: straight to the menu bar, no window.
	hidden := slices.Contains(os.Args[1:], "--hidden")
	app := NewApp()

	err := wails.Run(&options.App{
		Title:     "SparkX MIDI",
		Width:     980,
		Height:    700,
		MinWidth:  780,
		MinHeight: 560,
		// A menu-bar app: closing the window only hides it. The bridge keeps running and
		// Quit lives in the menu-bar menu.
		HideWindowOnClose: true,
		StartHidden:       hidden,
		AssetServer:       &assetserver.Options{Assets: assets},
		BackgroundColour:  &options.RGBA{R: 8, G: 9, B: 11, A: 1},
		Mac: &mac.Options{
			// No title bar; the traffic lights stay, inset over the app's own header,
			// which declares the drag region.
			TitleBar:   mac.TitleBarHiddenInset(),
			Appearance: mac.NSAppearanceNameDarkAqua,
			About: &mac.AboutInfo{
				Title:   "SparkX MIDI",
				Message: "Turns a Spark Control X into a MIDI foot controller.\nNot affiliated with Positive Grid.",
			},
		},
		OnStartup:  app.startup,
		OnShutdown: app.shutdown,
		Bind:       []interface{}{app},
	})
	if err != nil {
		log.Println("Error:", err.Error())
	}
}
