package coremidi

import "errors"

// ErrUnsupported is NewVirtual's error where there is no CoreMIDI.
var ErrUnsupported = errors.New("coremidi: not available on this platform")
