//go:build linux && !(cgo && desktop)

package main

// Tests and lint build package main without Wails' "desktop" tag, so without GTK.
func setGtkPreferDark(bool) {}
