//go:build !darwin

package ble

import (
	"context"
	"errors"
	"time"
)

// Only macOS has a radio here. Elsewhere Bluetooth reads as unavailable, so the
// Manager sits in StateOff and everything still builds and tests.

var errNoRadio = errors.New("bluetooth is only supported on macOS")

type noRadio struct{}

func newRadio() radio { return noRadio{} }

func (noRadio) power() (bool, string)   { return false, "Bluetooth is only supported on macOS" }
func (noRadio) enable() error           { return errNoRadio }
func (noRadio) held() ([]Device, error) { return nil, nil }

func (noRadio) scan(context.Context, time.Duration, func(Device) bool) error { return errNoRadio }

func (noRadio) dial(context.Context, string, time.Duration, sink) (conn, error) {
	return nil, errNoRadio
}
