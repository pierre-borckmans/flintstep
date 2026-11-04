package coremidi

// parser turns the byte stream arriving on the LED destination into complete channel
// messages. CoreMIDI packets may split a message, rely on running status, or carry
// realtime bytes in the middle of one; none of that should reach the caller.
//
// Kept: channel voice messages (0x80..0xEF), always with their status byte.
// Dropped: sysex (0xF0..0xF7 and everything between), system common (0xF1..0xF6)
// and their data bytes, realtime (0xF8..0xFF) wherever it appears.
type parser struct {
	status  byte // running status; 0 = none, data bytes are ignored
	need    int  // data bytes the current status takes
	data    [2]byte
	n       int
	inSysex bool
}

// feed consumes one packet's bytes and calls emit with each message completed by them.
// The slice passed to emit is the caller's to keep.
func (p *parser) feed(b []byte, emit func([]byte)) {
	for _, c := range b {
		switch {
		case c >= 0xF8: // realtime: may appear anywhere, changes nothing
			continue
		case c == 0xF0:
			p.inSysex, p.status, p.n = true, 0, 0
		case c == 0xF7:
			p.inSysex, p.status, p.n = false, 0, 0
		case c >= 0xF1: // system common: cancels running status; its data falls on the floor
			p.inSysex, p.status, p.n = false, 0, 0
		case c >= 0x80:
			p.inSysex, p.status, p.n = false, c, 0
			p.need = 2
			if t := c & 0xF0; t == 0xC0 || t == 0xD0 {
				p.need = 1
			}
		default: // data byte
			if p.inSysex || p.status == 0 {
				continue
			}
			p.data[p.n] = c
			p.n++
			if p.n == p.need {
				msg := make([]byte, 1+p.need)
				msg[0] = p.status
				copy(msg[1:], p.data[:p.need])
				p.n = 0
				emit(msg)
			}
		}
	}
}
