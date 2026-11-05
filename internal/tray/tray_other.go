//go:build !(darwin && cgo) && !linux

// Package tray is the app's menu bar (macOS) or tray (Linux) item. Elsewhere it does
// nothing, and Available says so.
package tray

import "time"

// Available reports that this platform has no tray.
func Available(time.Duration) bool { return false }

// Start does nothing on this platform.
func Start(templateIconPNG []byte, onClick func(id string)) {}

// SetMenu does nothing on this platform.
func SetMenu(items []Item) {}

// SetTooltip does nothing on this platform.
func SetTooltip(s string) {}
