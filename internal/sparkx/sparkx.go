package sparkx

import (
	"strings"
)

// POSITIVE GRID SPARK CONTROL X, THE PROTOCOL HALF.
//
// The Spark Control X advertises the BLE-MIDI service but never sends a MIDI message.
// Its switches, expression inputs, battery and lamps all go through two vendor services
// instead. The design doc has the protocol as verified on
// firmware 4.1.23; Paul Hamshere's notes (github.com/paulhamsh/Spark-Control-X) are where
// it was first written down.
//
//   - Switches: service 7BDB8DC0-6C95-11E3-981F-0800200C9A66, notify characteristic
//     362F71A0-6C96-11E3-981F-0800200C9A66. One byte, a bitmask of the switches held now.
//   - Commands: service FFC8. FFC9 is written by the host (with response), FFCA notifies.
//     Every message is a type byte and three zeros, then its payload.
//
// This package is the pure part: bitmask edges, reading FFCA messages, building the
// requests and lamp messages we are allowed to send. The BLE glue is internal/ble.
//
// SAFE MESSAGES ONLY. The pedal keeps its profiles in flash, and some command types
// rewrite them (0x03 sent to the pedal, 0x07, 0x0A, 0x0E calibration, 0x13). Nothing
// here can build those: the only things this file encodes are info requests and 0x01
// lamp messages, and lamp state is volatile (a power cycle clears it).
//
// namePrefix starts the name the pedal advertises: " v4.1.23 fbfc".
const namePrefix = "SparkX"

// IsName reports whether an advertised name is a Spark Control X.
func IsName(name string) bool {
	return strings.HasPrefix(strings.TrimSpace(name), namePrefix)
}

// GATT identifiers.
const (
	SwitchService = "7BDB8DC0-6C95-11E3-981F-0800200C9A66"
	SwitchChar    = "362F71A0-6C96-11E3-981F-0800200C9A66"
	CommandSvc    = 0xFFC8
	CommandTx     = 0xFFC9 // host → pedal, write with response
	CommandRx     = 0xFFCA // pedal → host, notify
)

// Switches is how many footswitches the pedal has. Bit n of the switch mask is
// switch n, and lamp n sits above it.
const Switches = 6

// SwitchNames are the switches' printed names, by bit. The pedal has two rows:
// I II A on top, III IV B below.
var SwitchNames = [Switches]string{"I", "II", "A", "III", "IV", "B"}

// Lamps besides the six switch lamps.
const (
	LampAmp = 6 // the "Amp" light
	LampApp = 7 // the "App" light
	Lamps   = 8
)

// ExpInputs is how many expression jacks the pedal has.
const ExpInputs = 2

// Edge is one switch going down or up.
type Edge struct {
	Switch int
	Down   bool
}

// Edges is what changed between two switch masks: releases first, then presses,
// each in switch order. Releasing one switch and pressing another in the same
// notification then reads as the release it was, followed by the press.
func Edges(prev, cur byte) []Edge {
	var out []Edge
	up, down := prev&^cur, cur&^prev
	for n := 0; n < Switches; n++ {
		if up&(1<<n) != 0 {
			out = append(out, Edge{Switch: n})
		}
	}
	for n := 0; n < Switches; n++ {
		if down&(1<<n) != 0 {
			out = append(out, Edge{Switch: n, Down: true})
		}
	}
	return out
}

// Command types on FFC9/FFCA.
const (
	sxLamp        = 0x01 // host → pedal: set one lamp
	sxProfileCmd  = 0x03 // pedal → host: a switch's profile command (NEVER sent to it)
	sxProfile     = 0x08 // request/reply: the current profile
	sxFirmware    = 0x0B // request/reply: firmware version, ASCII
	sxExp         = 0x0C // pedal → host: both expression values
	sxCables      = 0x0D // request/reply and unsolicited: which exp jacks have a cable
	sxBattery     = 0x0F // request/reply: battery percent
	sxPower       = 0x11 // request/reply: 1 on USB power, 0 on battery
	sxProfileName = 0x12 // request/reply: a profile's name, ASCII
	sxLayout      = 0x14 // request/reply: a profile's per-switch command layout
)

// sxPayload is where a message's payload starts: the type byte and three zeros.
const sxPayload = 4

// Msg is one message from FFCA, read. Kind is one of the Msg* constants;
// the fields that kind does not use are zero.
type Msg struct {
	Kind string
	// Exp is the two expression inputs, raw 0..65535 (MsgExp).
	Exp [ExpInputs]int
	// Cables has bit 0 for input 1 and bit 1 for input 2 (MsgCables).
	Cables int
	// Value is the battery percent, the profile number, the profile command, or
	// for MsgPower 1 on USB power and 0 on battery.
	Value int
	// Text is the firmware version or a profile name.
	Text string
	// Raw is the payload, for MsgLayout and MsgOther.
	Raw []byte
}

// Msg kinds.
const (
	MsgExp         = "exp"
	MsgCables      = "cables"
	MsgBattery     = "battery"
	MsgFirmware    = "firmware"
	MsgProfile     = "profile"
	MsgProfileName = "profileName"
	MsgProfileCmd  = "profileCmd"
	MsgLayout      = "layout"
	MsgPower       = "power"
	MsgOther       = "other"
)

// ParseMsg reads one FFCA notification. Anything too short to carry its kind's
// payload, or that does not start with a type and three zeros, is not a message.
func ParseMsg(b []byte) (Msg, bool) {
	if len(b) < sxPayload || b[1] != 0 || b[2] != 0 || b[3] != 0 {
		return Msg{}, false
	}
	p := b[sxPayload:]
	last := func() (int, bool) {
		if len(p) == 0 {
			return 0, false
		}
		return int(p[len(p)-1]), true
	}
	switch b[0] {
	case sxExp:
		// 01 <lo> <hi> 02 <lo> <hi>
		if len(p) < 6 || p[0] != 1 || p[3] != 2 {
			return Msg{}, false
		}
		return Msg{Kind: MsgExp, Exp: [2]int{int(p[1]) | int(p[2])<<8, int(p[4]) | int(p[5])<<8}}, true
	case sxCables:
		v, ok := last()
		return Msg{Kind: MsgCables, Cables: v & 3}, ok
	case sxBattery:
		v, ok := last()
		if !ok || v > 100 {
			return Msg{}, false
		}
		return Msg{Kind: MsgBattery, Value: v}, true
	case sxPower:
		// "11 00 00 00 01" on USB power, "... 00" on battery (docs/PROTOCOL-NOTES.md).
		v, ok := last()
		if !ok || v > 1 {
			return Msg{}, false
		}
		return Msg{Kind: MsgPower, Value: v}, true
	case sxProfile:
		v, ok := last()
		return Msg{Kind: MsgProfile, Value: v}, ok
	case sxProfileCmd:
		v, ok := last()
		return Msg{Kind: MsgProfileCmd, Value: v}, ok
	case sxFirmware:
		// The version starts after one more byte: "0b 00 00 00 xx 34 2e 31 2e 32 33 00..".
		if len(p) < 1 {
			return Msg{}, false
		}
		return Msg{Kind: MsgFirmware, Text: sxText(p[1:])}, true
	case sxProfileName:
		if len(p) < 1 {
			return Msg{}, false
		}
		return Msg{Kind: MsgProfileName, Value: int(p[0]), Text: sxText(p[1:])}, true
	case sxLayout:
		return Msg{Kind: MsgLayout, Raw: append([]byte(nil), p...)}, true
	}
	return Msg{Kind: MsgOther, Value: int(b[0]), Raw: append([]byte(nil), p...)}, true
}

// sxText is the printable ASCII in b, with the zero padding dropped.
func sxText(b []byte) string {
	var sb strings.Builder
	for _, c := range b {
		if c >= 0x20 && c < 0x7F {
			sb.WriteByte(c)
		}
	}
	return strings.TrimSpace(sb.String())
}

func sxRequest(kind byte, payload ...byte) []byte {
	return append([]byte{kind, 0, 0, 0}, payload...)
}

// The info requests. Each is answered with a message of the same type. The firmware
// and cable requests are padded to 32 bytes, as the pedal's own app sends them.
func FirmwareRequest() []byte         { return sxRequest(sxFirmware, make([]byte, 28)...) }
func ProfileRequest() []byte          { return sxRequest(sxProfile) }
func BatteryRequest() []byte          { return sxRequest(sxBattery) }
func CablesRequest() []byte           { return sxRequest(sxCables, make([]byte, 28)...) }
func ProfileNameRequest(p int) []byte { return sxRequest(sxProfileName, byte(p)) }

// PowerRequest asks whether USB is powering the pedal. Read-only: a Spark II amp sends
// it routinely, and the reply is MsgPower.
func PowerRequest() []byte { return sxRequest(sxPower) }

// Colour is a lamp colour. All zero is off.
type Colour struct {
	R uint8 `json:"r"`
	G uint8 `json:"g"`
	B uint8 `json:"b"`
}

// lampBrightness is the brightness byte every lamp message carries. Dimming is done
// by scaling the colour instead: 0x7F is the value verified on hardware.
const lampBrightness = 0x7F

// LampMessages sets lamp n (0..7) to c. The pedal keeps two colour states per
// lamp; both get the same colour, which is what was verified to light it steadily.
// Out-of-range lamps give nothing.
func LampMessages(n int, c Colour) [][]byte {
	if n < 0 || n >= Lamps {
		return nil
	}
	out := make([][]byte, 0, 2)
	for _, state := range []byte{1, 2} {
		out = append(out, sxRequest(sxLamp, 0x01, byte(n), state, lampBrightness, 0, c.B, c.G, c.R, 0))
	}
	return out
}

// LampSet is the lamps' wanted colours against what was last sent, so only
// changes reach the pedal. Not safe for concurrent use.
type LampSet struct {
	want [Lamps]Colour
	sent [Lamps]Colour
	// known marks the lamps whose real state we know: none after a connect, since the
	// pedal may still show what the last app gave it.
	known [Lamps]bool
}

// Set records lamp n's wanted colour.
func (s *LampSet) Set(n int, c Colour) {
	if n >= 0 && n < Lamps {
		s.want[n] = c
	}
}

// Want is lamp n's wanted colour.
func (s *LampSet) Want(n int) Colour { return s.want[n] }

// Forget makes every lamp unknown, so the next Flush sends them all.
func (s *LampSet) Forget() { s.known = [Lamps]bool{} }

// Flush returns the messages that bring the pedal to the wanted state, and counts them
// as sent.
func (s *LampSet) Flush() [][]byte {
	var out [][]byte
	for n := range s.want {
		if s.known[n] && s.sent[n] == s.want[n] {
			continue
		}
		out = append(out, LampMessages(n, s.want[n])...)
		s.sent[n], s.known[n] = s.want[n], true
	}
	return out
}

// ExpScale turns raw expression values into 0..127 with hysteresis: the output
// moves only once the input is more than half a step past the edge of the current
// value, so a pedal resting on a boundary, or the noise of an empty jack, does not
// flicker between two values.
type ExpScale struct {
	last [ExpInputs]int // -1 before the first reading
}

// NewExpScale starts with no readings.
func NewExpScale() *ExpScale {
	return &ExpScale{last: [ExpInputs]int{-1, -1}}
}

// sxExpStep is one 7-bit step in raw units.
const sxExpStep = 65535.0 / 127

// Feed reads input n's raw value and returns its 7-bit value and whether that changed.
func (s *ExpScale) Feed(n, raw int) (int, bool) {
	raw = min(max(raw, 0), 65535)
	v := int(float64(raw)/sxExpStep + 0.5)
	prev := s.last[n]
	if prev >= 0 {
		if v == prev {
			return prev, false
		}
		// Only move when the raw value is clearly inside the new step, past a margin of
		// a quarter step beyond the rounding edge.
		centre := float64(prev) * sxExpStep
		if d := float64(raw) - centre; d < 0.75*sxExpStep && d > -0.75*sxExpStep {
			return prev, false
		}
	}
	s.last[n] = v
	return v, true
}

// Reset forgets input n's reading: its cable came out.
func (s *ExpScale) Reset(n int) { s.last[n] = -1 }

// Status is what the app knows of one connected Spark Control X, for the UI.
type Status struct {
	Firmware    string `json:"firmware"`
	Profile     int    `json:"profile"` // -1 until read
	ProfileName string `json:"profileName"`
	// Battery is 0..100, or NoBattery until read.
	Battery int `json:"battery"`
	// Powered is true while USB powers the pedal. Charging is Powered with the battery
	// below 100: the pedal reports nothing more.
	Powered bool `json:"powered"`
	// Cables says which expression jacks have a cable: [input 1, input 2].
	Cables [ExpInputs]bool `json:"cables"`
	// Exp is each input's value 0..127, or -1 with no cable or no reading yet.
	Exp [ExpInputs]int `json:"exp"`
	// Held is the switch mask: bit n is switch n, held now.
	Held int `json:"held"`
	// Lamps is the colour each lamp was last set to.
	Lamps [Lamps]Colour `json:"lamps"`
}

// NewStatus is the status before the pedal has said anything.
func NewStatus() Status {
	return Status{Profile: -1, Battery: NoBattery, Exp: [2]int{-1, -1}}
}

// NoBattery is the battery level before the pedal has reported one.
const NoBattery = -1
