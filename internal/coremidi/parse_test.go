package coremidi

import (
	"reflect"
	"testing"

	"flintstep/internal/product"
)

func run(packets ...[]byte) [][]byte {
	var p parser
	var out [][]byte
	for _, pk := range packets {
		p.feed(pk, func(m []byte) { out = append(out, m) })
	}
	return out
}

func TestParser(t *testing.T) {
	tests := []struct {
		name    string
		packets [][]byte
		want    [][]byte
	}{
		{"single cc", [][]byte{{0xB0, 80, 127}}, [][]byte{{0xB0, 80, 127}}},
		{"two in one packet", [][]byte{{0xB0, 80, 127, 0x91, 60, 100}},
			[][]byte{{0xB0, 80, 127}, {0x91, 60, 100}}},
		{"running status", [][]byte{{0xB2, 1, 2, 3, 4, 5, 6}},
			[][]byte{{0xB2, 1, 2}, {0xB2, 3, 4}, {0xB2, 5, 6}}},
		{"running status across packets", [][]byte{{0x90, 60, 100}, {61, 0}},
			[][]byte{{0x90, 60, 100}, {0x90, 61, 0}}},
		{"split packets", [][]byte{{0xB0}, {80}, {127}}, [][]byte{{0xB0, 80, 127}}},
		{"program change and pressure take one byte", [][]byte{{0xC3, 5, 6, 0xD0, 40}},
			[][]byte{{0xC3, 5}, {0xC3, 6}, {0xD0, 40}}},
		{"pitch bend", [][]byte{{0xE0, 0, 64}}, [][]byte{{0xE0, 0, 64}}},
		{"realtime interleaved", [][]byte{{0xB0, 0xF8, 80, 0xFE, 127, 0xFA}},
			[][]byte{{0xB0, 80, 127}}},
		{"realtime keeps running status", [][]byte{{0xB0, 1, 2, 0xF8, 3, 4}},
			[][]byte{{0xB0, 1, 2}, {0xB0, 3, 4}}},
		{"sysex dropped", [][]byte{{0xF0, 0x7E, 0x00, 0x06, 0x01, 0xF7, 0xB0, 1, 2}},
			[][]byte{{0xB0, 1, 2}}},
		{"sysex across packets", [][]byte{{0xF0, 1, 2}, {3, 4, 0xF8}, {5, 0xF7}, {0x80, 60, 0}},
			[][]byte{{0x80, 60, 0}}},
		{"sysex cancels running status", [][]byte{{0xB0, 1, 2, 0xF0, 1, 0xF7, 3, 4}},
			[][]byte{{0xB0, 1, 2}}},
		{"unterminated sysex ended by status", [][]byte{{0xF0, 1, 2, 0x90, 60, 1}},
			[][]byte{{0x90, 60, 1}}},
		{"system common and its data dropped", [][]byte{{0xB0, 1, 2, 0xF2, 3, 4, 0xF3, 5, 0xB1, 7, 8}},
			[][]byte{{0xB0, 1, 2}, {0xB1, 7, 8}}},
		{"leading data without status", [][]byte{{1, 2, 3, 0xB0, 4, 5}}, [][]byte{{0xB0, 4, 5}}},
		{"status interrupts partial message", [][]byte{{0xB0, 1, 0x90, 60, 100}},
			[][]byte{{0x90, 60, 100}}},
		{"empty", [][]byte{{}}, nil},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := run(tt.packets...); !reflect.DeepEqual(got, tt.want) {
				t.Errorf("got % X, want % X", got, tt.want)
			}
		})
	}
}

func TestParserMessagesAreIndependent(t *testing.T) {
	got := run([]byte{0xB0, 1, 2, 3, 4})
	got[0][1] = 99
	if got[1][1] != 3 {
		t.Fatalf("messages share storage: % X", got)
	}
}

func TestStableUID(t *testing.T) {
	a, b := stableUID(product.MIDIPortName), stableUID(product.MIDILEDPortName)
	if a == b {
		t.Fatalf("source and destination share an ID %d", a)
	}
	if a != stableUID(product.MIDIPortName) {
		t.Fatal("ID not stable")
	}
	if a == 0 || b == 0 {
		t.Fatal("zero ID")
	}
	if nextUID(-1) != 1 || nextUID(5) != 6 {
		t.Fatal("nextUID")
	}
}
