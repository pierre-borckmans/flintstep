package mapping

import "sparkbridge/internal/sparkx"

// THE AMP AND APP LAMPS. Two small dots above the switches with no switch under them.
// On the stock pedal they show the amp link and the app link; here each one shows
// whatever the user picks: the pedal being held, MIDI going out, MIDI coming in, USB
// power, always on, or nothing.

// IndicatorMode is what lights an indicator lamp.
type IndicatorMode string

// Indicator modes. frontend/src/lib/indicators.ts mirrors them.
const (
	IndicatorOff       IndicatorMode = "off"
	IndicatorConnected IndicatorMode = "connected" // lit while the bridge holds the pedal
	IndicatorMIDIOut   IndicatorMode = "midiOut"   // flashes on each message sent to apps
	IndicatorMIDIIn    IndicatorMode = "midiIn"    // flashes on each message to the LED destination
	IndicatorUSB       IndicatorMode = "usb"       // lit while USB powers the pedal
	IndicatorOn        IndicatorMode = "on"        // always lit
)

// Indicator is one of the two lamps without a switch.
type Indicator struct {
	Mode   IndicatorMode `json:"mode"`
	Colour sparkx.Colour `json:"colour"` // the colour when lit
}

// Which Config.Indicators entry is which lamp.
const (
	IndicatorAmp = 0 // sparkx.LampAmp
	IndicatorApp = 1 // sparkx.LampApp
	Indicators   = 2
)

// defaultIndicators: Amp in a soft green flashes with MIDI out, App in indigo says the
// pedal is held. Both dim enough to sit beside the switch lamps.
var defaultIndicators = [Indicators]Indicator{
	{Mode: IndicatorMIDIOut, Colour: sparkx.Colour{R: 0x00, G: 0xB0, B: 0x50}},
	{Mode: IndicatorConnected, Colour: sparkx.Colour{R: 0x40, G: 0x20, B: 0xFF}},
}

func validIndicatorMode(m IndicatorMode) bool {
	switch m {
	case IndicatorOff, IndicatorConnected, IndicatorMIDIOut, IndicatorMIDIIn, IndicatorUSB, IndicatorOn:
		return true
	}
	return false
}

// IndicatorState is what the indicator lamps can follow. Out and In are true while a
// flash is lit: the bridge times them.
type IndicatorState struct {
	Connected bool // the bridge holds the pedal
	Powered   bool // USB powers the pedal
	Out       bool // MIDI went out in the last flash time
	In        bool // MIDI came in on the LED destination in the last flash time
}

// IndicatorLamps is what the Amp and App lamps should show in state st, dimmed by the
// config's Brightness like the switch lamps.
func IndicatorLamps(cfg Config, st IndicatorState) [Indicators]sparkx.Colour {
	var out [Indicators]sparkx.Colour
	for n, ind := range cfg.Indicators {
		var lit bool
		switch ind.Mode {
		case IndicatorConnected:
			lit = st.Connected
		case IndicatorMIDIOut:
			lit = st.Out
		case IndicatorMIDIIn:
			lit = st.In
		case IndicatorUSB:
			lit = st.Powered
		case IndicatorOn:
			lit = true
		}
		if lit {
			out[n] = dim(ind.Colour, cfg.Brightness)
		}
	}
	return out
}
