package sparkx

import (
	"bytes"
	"reflect"
	"testing"
)

func TestIsName(t *testing.T) {
	for name, want := range map[string]bool{
		"SparkX v4.1.23 fbfc": true,
		"SparkX":              true,
		"BEAM Control":        false,
		"Spark 40 Audio":      false,
		"":                    false,
	} {
		if got := IsName(name); got != want {
			t.Errorf("IsName(%q) = %v, want %v", name, got, want)
		}
	}
}

func TestEdges(t *testing.T) {
	cases := []struct {
		prev, cur byte
		want      []Edge
	}{
		{0x00, 0x00, nil},
		{0x00, 0x01, []Edge{{Switch: 0, Down: true}}},
		{0x01, 0x00, []Edge{{Switch: 0}}},
		// B (bit 5) held while I goes down and up.
		{0x20, 0x21, []Edge{{Switch: 0, Down: true}}},
		// one release and one press in the same notification: release first.
		{0x04, 0x08, []Edge{{Switch: 2}, {Switch: 3, Down: true}}},
		// two at once, in switch order; bits above the six switches are ignored.
		{0xC0, 0x12, []Edge{{Switch: 1, Down: true}, {Switch: 4, Down: true}}},
	}
	for _, c := range cases {
		if got := Edges(c.prev, c.cur); !reflect.DeepEqual(got, c.want) {
			t.Errorf("Edges(%02x, %02x) = %v, want %v", c.prev, c.cur, got, c.want)
		}
	}
}

func TestParseMsg(t *testing.T) {
	fw := append([]byte{0x0b, 0, 0, 0, 0x00}, []byte("4.1.23")...)
	fw = append(fw, make([]byte, 21)...)
	name := append([]byte{0x12, 0, 0, 0, 0x01}, []byte("Rock Set")...)
	name = append(name, 0, 0, 0)
	cases := []struct {
		in   []byte
		want Msg
	}{
		{[]byte{0x0c, 0, 0, 0, 0x01, 0x34, 0x12, 0x02, 0xff, 0xff}, Msg{Kind: MsgExp, Exp: [2]int{0x1234, 65535}}},
		{[]byte{0x0d, 0, 0, 0, 0x02}, Msg{Kind: MsgCables, Cables: 2}},
		{[]byte{0x0f, 0, 0, 0, 87}, Msg{Kind: MsgBattery, Value: 87}},
		{[]byte{0x08, 0, 0, 0, 3}, Msg{Kind: MsgProfile, Value: 3}},
		{[]byte{0x03, 0, 0, 0, 0x2a}, Msg{Kind: MsgProfileCmd, Value: 0x2a}},
		{fw, Msg{Kind: MsgFirmware, Text: "4.1.23"}},
		{name, Msg{Kind: MsgProfileName, Value: 1, Text: "Rock Set"}},
		{[]byte{0x14, 0, 0, 0, 1, 2, 3}, Msg{Kind: MsgLayout, Raw: []byte{1, 2, 3}}},
		{[]byte{0x42, 0, 0, 0, 9}, Msg{Kind: MsgOther, Value: 0x42, Raw: []byte{9}}},
	}
	for _, c := range cases {
		got, ok := ParseMsg(c.in)
		if !ok || !reflect.DeepEqual(got, c.want) {
			t.Errorf("ParseMsg(% x) = %+v %v, want %+v", c.in, got, ok, c.want)
		}
	}
	for _, bad := range [][]byte{
		nil,
		{0x0f, 0, 0},
		{0x0f, 1, 0, 0, 50},               // not three zeros
		{0x0f, 0, 0, 0},                   // no payload
		{0x0f, 0, 0, 0, 101},              // not a percent
		{0x0c, 0, 0, 0, 1, 2, 3},          // short exp
		{0x0c, 0, 0, 0, 2, 0, 0, 1, 0, 0}, // inputs out of order
	} {
		if m, ok := ParseMsg(bad); ok {
			t.Errorf("ParseMsg(% x) = %+v, want no message", bad, m)
		}
	}
}

func TestRequestsAreSafe(t *testing.T) {
	// The only types we may ever write: info requests and lamps.
	safe := map[byte]bool{0x01: true, 0x08: true, 0x0b: true, 0x0d: true, 0x0f: true, 0x12: true}
	reqs := [][]byte{FirmwareRequest(), ProfileRequest(), BatteryRequest(),
		CablesRequest(), ProfileNameRequest(2)}
	reqs = append(reqs, LampMessages(0, Colour{R: 1})...)
	for _, r := range reqs {
		if !safe[r[0]] || r[1] != 0 || r[2] != 0 || r[3] != 0 {
			t.Errorf("unsafe or malformed request % x", r)
		}
	}
	if got := FirmwareRequest(); len(got) != 32 {
		t.Errorf("firmware request is %d bytes, want 32 (0b + 31 zeros as verified)", len(got))
	}
	if got := ProfileNameRequest(2); !bytes.Equal(got, []byte{0x12, 0, 0, 0, 2}) {
		t.Errorf("profile name request % x", got)
	}
}

func TestLampMessages(t *testing.T) {
	got := LampMessages(4, Colour{R: 0xAA, G: 0xBB, B: 0xCC})
	want := [][]byte{
		{0x01, 0, 0, 0, 0x01, 4, 1, 0x7f, 0, 0xCC, 0xBB, 0xAA, 0},
		{0x01, 0, 0, 0, 0x01, 4, 2, 0x7f, 0, 0xCC, 0xBB, 0xAA, 0},
	}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("lamp messages\n got % x\nwant % x", got, want)
	}
	if LampMessages(8, Colour{}) != nil || LampMessages(-1, Colour{}) != nil {
		t.Error("out-of-range lamp built a message")
	}
}

func TestLampSetSendsOnlyChanges(t *testing.T) {
	var s LampSet
	// Nothing is known after a connect: the first flush sets every lamp, off included.
	if got := len(s.Flush()); got != 2*Lamps {
		t.Fatalf("first flush sent %d messages, want %d", got, 2*Lamps)
	}
	if got := s.Flush(); len(got) != 0 {
		t.Fatalf("idle flush sent %d messages", len(got))
	}
	red := Colour{R: 255}
	s.Set(2, red)
	s.Set(2, red)
	got := s.Flush()
	if len(got) != 2 || got[0][5] != 2 {
		t.Fatalf("one changed lamp sent % x", got)
	}
	s.Set(2, red) // same again: nothing
	if len(s.Flush()) != 0 {
		t.Fatal("unchanged lamp sent again")
	}
	s.Forget()
	if got := len(s.Flush()); got != 2*Lamps {
		t.Fatalf("after Forget sent %d, want all", got)
	}
}

func TestExpScaleHysteresis(t *testing.T) {
	s := NewExpScale()
	if v, ok := s.Feed(0, 0); !ok || v != 0 {
		t.Fatalf("first reading = %d %v", v, ok)
	}
	// Noise around a value stays put.
	for _, raw := range []int{100, 300, 0, 200} {
		if v, ok := s.Feed(0, raw); ok {
			t.Fatalf("noise %d moved it to %d", raw, v)
		}
	}
	// Just past the rounding edge is not enough...
	if _, ok := s.Feed(0, 310); ok {
		t.Fatal("moved inside the margin")
	}
	// ...clearly inside the next step is.
	if v, ok := s.Feed(0, 516); !ok || v != 1 {
		t.Fatalf("one step = %d %v", v, ok)
	}
	if v, ok := s.Feed(0, 65535); !ok || v != 127 {
		t.Fatalf("toe = %d %v", v, ok)
	}
	if v, ok := s.Feed(0, 0); !ok || v != 0 {
		t.Fatalf("heel = %d %v", v, ok)
	}
	// The inputs are independent, and Reset starts one over.
	if v, ok := s.Feed(1, 65535); !ok || v != 127 {
		t.Fatalf("input 2 = %d %v", v, ok)
	}
	s.Reset(1)
	if _, ok := s.Feed(1, 65535); !ok {
		t.Fatal("reset input did not report its first reading")
	}
}
