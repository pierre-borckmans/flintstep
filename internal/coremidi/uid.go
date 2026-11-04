package coremidi

import "hash/fnv"

// stableUID is the kMIDIPropertyUniqueID an endpoint called name asks for. It is the
// same on every launch, so a DAW that mapped "Spark Control X" finds it again after a
// restart. Zero is avoided: CoreMIDI treats it as "no ID".
func stableUID(name string) int32 {
	h := fnv.New32a()
	_, _ = h.Write([]byte("com.silversol.sparkxmidi/" + name))
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
