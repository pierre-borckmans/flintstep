//go:build !darwin || !cgo

// Package coremidi publishes the bridge's virtual MIDI endpoints on macOS. Elsewhere
// (Linux CI, a darwin build without cgo) there is no CoreMIDI, and NewVirtual says so.
package coremidi

// Virtual is never created on this platform.
type Virtual struct{}

// NewVirtual reports that this platform has no CoreMIDI.
func NewVirtual(client, source, dest string, onDest func(msg []byte)) (*Virtual, error) {
	return nil, ErrUnsupported
}

// Send reports that this platform has no CoreMIDI.
func (v *Virtual) Send(msg []byte) error { return ErrUnsupported }

// Close does nothing.
func (v *Virtual) Close() {}
