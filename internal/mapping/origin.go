package mapping

// ORIGINS: what made each message, so the activity log can point back at the config.

// Source is the kind of thing that produced a message.
type Source string

const (
	SrcSwitch   Source = "switch"   // a switch's Tap action (press or release half)
	SrcLong     Source = "long"     // a switch's Long action
	SrcCombo    Source = "combo"    // two switches pressed together
	SrcExp      Source = "exp"      // an expression input's CC
	SrcTrigger  Source = "trigger"  // an expression input's trigger action
	SrcFeedback Source = "feedback" // MIDI in from the LED destination (the bridge's)
	SrcRelease  Source = "release"  // a release forced by a disconnect or a cable coming out
)

// Origin says which part of the config a message came from.
type Origin struct {
	Source Source
	// Index is the switch (0..5), the expression input (0..1) or the combo (its index
	// in Config.Combos). -1 when nothing in the config owns the message.
	Index int
	// Pair is a combo's two switches.
	Pair [2]int
	// Of is, for SrcRelease, what is being let go: SrcSwitch, SrcLong, SrcCombo or
	// SrcTrigger. Index and Pair are that thing's.
	Of Source
}

// Out is one message the engine wants sent, and where it came from.
type Out struct {
	Msg []byte
	Src Origin
}

// Outs is what the engine returns: messages in the order to send them.
type Outs []Out

// Msgs is the bare messages, nil when there are none.
func (o Outs) Msgs() [][]byte {
	if len(o) == 0 {
		return nil
	}
	m := make([][]byte, len(o))
	for i, x := range o {
		m[i] = x.Msg
	}
	return m
}

// tag gives every message the same origin.
func tag(msgs [][]byte, src Origin) Outs {
	if len(msgs) == 0 {
		return nil
	}
	o := make(Outs, len(msgs))
	for i, m := range msgs {
		o[i] = Out{Msg: m, Src: src}
	}
	return o
}

// released marks outs as a forced release.
func released(o Outs) Outs {
	for i := range o {
		o[i].Src.Of, o[i].Src.Source = o[i].Src.Source, SrcRelease
	}
	return o
}
