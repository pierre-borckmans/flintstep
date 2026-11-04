//go:build !darwin || !cgo

// Command miditest is a manual check of the macOS CoreMIDI and tray bindings; it does
// nothing elsewhere.
package main

import "fmt"

func main() { fmt.Println("miditest needs macOS with cgo") }
