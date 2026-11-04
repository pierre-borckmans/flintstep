package mapping

import "testing"

func TestDescribe(t *testing.T) {
	cases := []struct {
		in   []byte
		want string
	}{
		{[]byte{0xB0, 80, 127}, "CC 80 = 127 · ch 1"},
		{[]byte{0xBF, 7, 0}, "CC 7 = 0 · ch 16"},
		{[]byte{0x90, 60, 100}, "Note C4 on · vel 100 · ch 1"},
		{[]byte{0x92, 61, 1}, "Note C#4 on · vel 1 · ch 3"},
		{[]byte{0x90, 60, 0}, "Note C4 off · ch 1"},
		{[]byte{0x89, 0, 64}, "Note C-1 off · ch 10"},
		{[]byte{0x80, 127, 0}, "Note G9 off · ch 1"},
		{[]byte{0xC0, 5}, "Program 5 · ch 1"},
		{[]byte{0xC3, 0}, "Program 0 · ch 4"},
		{[]byte{0xF0, 0x7E, 0xF7}, "F0 7E F7"},
		{[]byte{0xB0, 80}, "B0 50"},
		{[]byte{0xE0, 0, 64}, "E0 00 40"},
		{nil, ""},
	}
	for _, c := range cases {
		if got := Describe(c.in); got != c.want {
			t.Errorf("Describe(% X) = %q, want %q", c.in, got, c.want)
		}
	}
}

func TestDescribeMatchesBuilders(t *testing.T) {
	cases := []struct {
		in   []byte
		want string
	}{
		{ccMsg(1, 80, 127), "CC 80 = 127 · ch 1"},
		{noteOn(16, 69, 100), "Note A4 on · vel 100 · ch 16"},
		{noteOff(2, 48), "Note C3 off · ch 2"},
		{pcMsg(1, 5), "Program 5 · ch 1"},
	}
	for _, c := range cases {
		if got := Describe(c.in); got != c.want {
			t.Errorf("Describe(% X) = %q, want %q", c.in, got, c.want)
		}
	}
}

func TestNoteName(t *testing.T) {
	for n, want := range map[int]string{0: "C-1", 60: "C4", 69: "A4", 127: "G9", 128: "128", -1: "-1"} {
		if got := NoteName(n); got != want {
			t.Errorf("NoteName(%d) = %q, want %q", n, got, want)
		}
	}
}
