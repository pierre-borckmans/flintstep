//go:build !(darwin && cgo) && !(linux && cgo)

// Package coremidi publishes the bridge's virtual MIDI endpoints: CoreMIDI on macOS,
// the ALSA sequencer on Linux (both need cgo). Elsewhere (Windows for now, a build
// without cgo) NewVirtual says it is unsupported.
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
