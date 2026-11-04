//go:build !darwin || !cgo

// Package tray is the app's macOS menu bar item. Elsewhere it does nothing.
package tray

// Start does nothing on this platform.
func Start(templateIconPNG []byte, onClick func(id string)) {}

// SetMenu does nothing on this platform.
func SetMenu(items []Item) {}

// SetTooltip does nothing on this platform.
func SetTooltip(s string) {}
