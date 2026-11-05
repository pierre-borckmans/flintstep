// Package product holds the app's names for the Go side. product.env at the repo root
// is the source of truth; these constants copy it, and product_test.go fails when the
// two disagree. Change product.env first, run `make product`, then edit this file.
package product

// From product.env.
const (
	// Name is the app's name: the window, the About box, the menu bar, log lines.
	Name = "Flintstep"
	// BundleID is the CFBundleIdentifier, the LaunchAgent label and the MIDI UID seed.
	BundleID = "com.silversol.flintstep"
	// MIDIPortName is the virtual MIDI source DAWs see. The same for every pedal model.
	MIDIPortName = "Flintstep"
	// MIDILEDPortName is the virtual MIDI destination a DAW sends LED feedback to.
	MIDILEDPortName = "Flintstep LEDs"
	// DataDirName is the data folder under ~/Library/Application Support.
	DataDirName = "Flintstep"
	// CLIName is the headless bridge's binary (cmd/flintstep-cli).
	CLIName = "flintstep-cli"
	// RepoSlug is the GitHub owner/repo.
	RepoSlug = "pierre-borckmans/flintstep"
	// SiteURL is the project's web page.
	SiteURL = "https://flintstep.app"
)

// The names the app shipped under before it was Flintstep. Only migration code reads
// them: the old data folder and LaunchAgent are moved over on first launch.
const (
	LegacyBundleID    = "com.silversol.sparkxmidi"
	LegacyDataDirName = "SparkX MIDI"
)
