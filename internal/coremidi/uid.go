package coremidi

import (
	"hash/fnv"

	"flintstep/internal/product"
)

// stableUID is the kMIDIPropertyUniqueID an endpoint called name asks for. It is the
// same on every launch, so a DAW that mapped the port finds it again after a restart.
// It is hashed from the bundle id and the name, so renaming either gives DAWs a new
// device. Zero is avoided: CoreMIDI treats it as "no ID".
func stableUID(name string) int32 {
	h := fnv.New32a()
	_, _ = h.Write([]byte(product.BundleID + "/" + name))
	u := int32(h.Sum32())
	if u == 0 {
		u = 1
	}
	return u
}

// nextUID is the ID to try after u collided with another endpoint's.
func nextUID(u int32) int32 {
	u++
	if u == 0 {
		u = 1
	}
	return u
}
