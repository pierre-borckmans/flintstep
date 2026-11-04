package mapping

import (
	"fmt"
	"strings"
)

// MIDI status nibbles.
const (
	stNoteOff = 0x80
	stNoteOn  = 0x90
	stCC      = 0xB0
	stPC      = 0xC0
)

func ccMsg(ch, num, v int) []byte { return []byte{byte(stCC | (ch-1)&0x0F), byte(num), byte(v)} }
func noteOn(ch, num, v int) []byte {
	return []byte{byte(stNoteOn | (ch-1)&0x0F), byte(num), byte(v)}
}
func noteOff(ch, num int) []byte { return []byte{byte(stNoteOff | (ch-1)&0x0F), byte(num), 0} }
func pcMsg(ch, num int) []byte   { return []byte{byte(stPC | (ch-1)&0x0F), byte(num)} }

var noteNames = [12]string{"C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"}

// NoteName is a note number in scientific pitch: 60 is C4, 0 is C-1.
func NoteName(n int) string {
	if n < 0 || n > 127 {
		return fmt.Sprint(n)
	}
	return fmt.Sprintf("%s%d", noteNames[n%12], n/12-1)
}

// Describe renders one MIDI message for the activity log: "CC 80 = 127 · ch 1",
// "Note C4 on · vel 100 · ch 1", "Program 5 · ch 1". Anything else is its bytes in hex.
func Describe(msg []byte) string {
	if len(msg) == 0 {
		return ""
	}
	ch := int(msg[0]&0x0F) + 1
	switch {
	case msg[0]&0xF0 == stCC && len(msg) >= 3:
		return fmt.Sprintf("CC %d = %d · ch %d", msg[1], msg[2], ch)
	case msg[0]&0xF0 == stNoteOn && len(msg) >= 3 && msg[2] > 0:
		return fmt.Sprintf("Note %s on · vel %d · ch %d", NoteName(int(msg[1])), msg[2], ch)
	case (msg[0]&0xF0 == stNoteOn || msg[0]&0xF0 == stNoteOff) && len(msg) >= 3:
		// A note on with velocity 0 is a note off, by the MIDI spec.
		return fmt.Sprintf("Note %s off · ch %d", NoteName(int(msg[1])), ch)
	case msg[0]&0xF0 == stPC && len(msg) >= 2:
		return fmt.Sprintf("Program %d · ch %d", msg[1], ch)
	}
	parts := make([]string, len(msg))
	for i, b := range msg {
		parts[i] = fmt.Sprintf("%02X", b)
	}
	return strings.Join(parts, " ")
}
