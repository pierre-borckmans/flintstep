package store

import (
	"os"
	"path/filepath"
	"reflect"
	"runtime"
	"strings"
	"testing"

	"flintstep/internal/mapping"
	"flintstep/internal/sparkx"
)

func TestLoad(t *testing.T) {
	custom := mapping.Default()
	custom.Switches[0].Tap.Number = 20
	custom.LEDMode = mapping.LEDFeedback
	custom.Brightness = 0

	cases := []struct {
		name    string
		content *string // nil = no file
		want    func(t *testing.T, c mapping.Config)
		wantErr string
	}{
		{"missing file is defaults, no error", nil, isDefault, ""},
		{"corrupt file is defaults and an error", ptr("{not json"), isDefault, "damaged"},
		{"wrong shape is defaults and an error", ptr(`{"switches": "lots"}`), isDefault, "damaged"},
		{"empty file is defaults and an error", ptr(""), isDefault, "damaged"},
		{"empty object is defaults", ptr("{}"), isDefault, ""},
		{"partial file is normalized", ptr(`{"version":1,"longPressMs":5,"ledMode":"x"}`), func(t *testing.T, c mapping.Config) {
			if c.LongPressMS != mapping.MinLongPressMS || c.LEDMode != mapping.LEDLocal || c.Switches[2].Tap.Number != 82 {
				t.Fatalf("not normalized: %+v", c)
			}
		}, ""},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			path := filepath.Join(t.TempDir(), "config.json")
			if c.content != nil {
				if err := os.WriteFile(path, []byte(*c.content), 0o644); err != nil {
					t.Fatal(err)
				}
			}
			got, err := Load(path)
			switch {
			case c.wantErr == "" && err != nil:
				t.Fatalf("unexpected error %v", err)
			case c.wantErr != "" && (err == nil || !strings.Contains(err.Error(), c.wantErr)):
				t.Fatalf("error %v, want %q", err, c.wantErr)
			}
			c.want(t, got)
		})
	}
}

func TestSaveLoadRoundTrip(t *testing.T) {
	path := filepath.Join(t.TempDir(), "nested", "config.json")
	c := mapping.Default()
	c.Pedal = mapping.PedalRef{Address: "ABCD-1234", Name: "SparkX v4"}
	c.Switches[3].Long = mapping.Action{Kind: mapping.KindNote, Channel: 2, Number: 64, Value: 90, Mode: mapping.Momentary}
	c.Switches[5].Colour = sparkx.Colour{R: 1, G: 2, B: 3}
	c.Combos = []mapping.Combo{{A: 0, B: 1, Action: mapping.Action{Kind: mapping.KindPC, Channel: 1, Number: 9, Value: 127, Mode: mapping.Momentary}}}
	c.Exp[1] = mapping.ExpConfig{Enabled: true, Channel: 3, CC: 1, Min: 1000, Max: 60000, Invert: true,
		Curve:   mapping.ExpCurve{Kind: mapping.CurveCustom, Amount: 0.35},
		Trigger: mapping.ExpTrigger{Mode: mapping.TriggerToe, Action: mapping.Action{Kind: mapping.KindNote, Channel: 2, Number: 40, Value: 100, Mode: mapping.Momentary}, Threshold: 90}}
	c.Brightness = 0 // a real choice once saved: must survive the round trip
	if err := Save(path, c); err != nil {
		t.Fatal(err)
	}
	got, err := Load(path)
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(got, c) {
		t.Fatalf("round trip:\n got %+v\nwant %+v", got, c)
	}

	// Saving again replaces the file and leaves no temp files behind.
	c.LongPressMS = 700
	if err := Save(path, c); err != nil {
		t.Fatal(err)
	}
	if got, _ := Load(path); got.LongPressMS != 700 {
		t.Fatalf("second save not read back: %d", got.LongPressMS)
	}
	entries, err := os.ReadDir(filepath.Dir(path))
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 1 || entries[0].Name() != "config.json" {
		var names []string
		for _, e := range entries {
			names = append(names, e.Name())
		}
		t.Fatalf("dir holds %v, want only config.json", names)
	}
}

func TestSaveFailureKeepsOldFile(t *testing.T) {
	if runtime.GOOS == "windows" || os.Getuid() == 0 {
		t.Skip("needs POSIX permissions and a non-root user")
	}
	dir := t.TempDir()
	path := filepath.Join(dir, "config.json")
	old := mapping.Default()
	old.LongPressMS = 900
	if err := Save(path, old); err != nil {
		t.Fatal(err)
	}
	if err := os.Chmod(dir, 0o555); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.Chmod(dir, 0o755) })
	if err := Save(path, mapping.Default()); err == nil {
		t.Fatal("save into a read-only dir succeeded")
	}
	if got, err := Load(path); err != nil || got.LongPressMS != 900 {
		t.Fatalf("old file damaged: %+v, %v", got.LongPressMS, err)
	}
}

func TestDir(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)
	t.Setenv("XDG_CONFIG_HOME", filepath.Join(home, ".config"))
	dir, err := Dir()
	if err != nil {
		t.Fatal(err)
	}
	if filepath.Base(dir) != "Flintstep" {
		t.Fatalf("Dir() = %s", dir)
	}
	if runtime.GOOS == "darwin" {
		if want := filepath.Join(home, "Library", "Application Support", "Flintstep"); dir != want {
			t.Fatalf("Dir() = %s, want %s", dir, want)
		}
	}
	if fi, err := os.Stat(dir); err != nil || !fi.IsDir() {
		t.Fatalf("Dir() not created: %v", err)
	}
}

func isDefault(t *testing.T, c mapping.Config) {
	t.Helper()
	if !reflect.DeepEqual(c, mapping.Default()) {
		t.Fatalf("got %+v, want Default()", c)
	}
}

func ptr(s string) *string { return &s }
