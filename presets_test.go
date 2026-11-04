package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"sparkbridge/internal/bridge"
	"sparkbridge/internal/mapping"
	"sparkbridge/internal/presets"
)

type fakeDialogs struct{ save, open string }

func (f *fakeDialogs) SaveFile(string) (string, error) { return f.save, nil }
func (f *fakeDialogs) OpenFile() (string, error)       { return f.open, nil }

// testApp is an App over a library in a temp dir and a bridge with no pedal or port.
func testApp(t *testing.T) (*App, *fakeDialogs) {
	t.Helper()
	lib, err := presets.Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	a := NewApp()
	a.emitTo = func(string, any) {}
	a.lib = lib
	d := &fakeDialogs{}
	a.dialogs = d
	a.bridge = bridge.New(lib.Active(), nil, bridge.Options{})
	t.Cleanup(a.bridge.Close)
	return a, d
}

func TestSelectPresetRunsIt(t *testing.T) {
	a, _ := testApp(t)
	_ = a.lib.SetPedal(mapping.PedalRef{Address: "aaaa", Name: "SparkX"})
	first := a.lib.ActiveID()

	c := mapping.Default()
	c.Switches[0].Tap.Number = 42
	if err := a.SaveConfig(c); err != nil {
		t.Fatal(err)
	}
	other, err := a.CreatePreset("Other", presets.FromDefault)
	if err != nil {
		t.Fatal(err)
	}
	got, err := a.SelectPreset(other.ID)
	if err != nil {
		t.Fatal(err)
	}
	if got.Switches[0].Tap.Number != 80 || a.bridge.Config().Switches[0].Tap.Number != 80 {
		t.Fatalf("the bridge did not get the selected preset")
	}
	if a.bridge.Config().Pedal.Address != "aaaa" {
		t.Fatalf("pedal lost on switch: %+v", a.bridge.Config().Pedal)
	}
	if _, err := a.SelectPreset(first); err != nil {
		t.Fatal(err)
	}
	if a.bridge.Config().Switches[0].Tap.Number != 42 {
		t.Fatalf("switching back lost the edit")
	}
	if _, err := a.SelectPreset("nope"); err == nil {
		t.Fatalf("selected a missing preset")
	}
	if a.lib.ActiveID() != first {
		t.Fatalf("a failed select moved the active preset")
	}
}

func TestDeleteActivePresetRunsTheNext(t *testing.T) {
	a, _ := testApp(t)
	b, _ := a.CreatePreset("B", presets.FromDefault)
	_, _ = a.SelectPreset(b.ID)
	c := mapping.Default()
	c.Brightness = 10
	_ = a.SaveConfig(c)
	if err := a.DeletePreset(b.ID); err != nil {
		t.Fatal(err)
	}
	if a.bridge.Config().Brightness != 100 {
		t.Fatalf("bridge still runs the deleted preset")
	}
	if err := a.DeletePreset(a.lib.ActiveID()); err == nil {
		t.Fatalf("deleted the last preset")
	}
}

func TestExportImportThroughDialogs(t *testing.T) {
	a, d := testApp(t)
	c := mapping.Default()
	c.LongPressMS = 900
	_ = a.SaveConfig(c)
	_ = a.RenamePreset(a.lib.ActiveID(), "Ableton live")

	// Cancelled: nothing written, no error.
	if err := a.ExportPreset(a.lib.ActiveID()); err != nil {
		t.Fatalf("cancelled export: %v", err)
	}
	if info, err := a.ImportPreset(); err != nil || info.ID != "" {
		t.Fatalf("cancelled import = %+v, %v", info, err)
	}

	d.save = filepath.Join(t.TempDir(), "Ableton live.sparkx.json")
	if err := a.ExportPreset(a.lib.ActiveID()); err != nil {
		t.Fatal(err)
	}
	b, err := os.ReadFile(d.save)
	if err != nil || !strings.Contains(string(b), `"format": "sparkx-midi-preset"`) {
		t.Fatalf("export file: %v\n%s", err, b)
	}
	d.open = d.save
	info, err := a.ImportPreset()
	if err != nil || info.Name != "Ableton live (2)" {
		t.Fatalf("import = %+v, %v", info, err)
	}
	got, _ := a.SelectPreset(info.ID)
	if got.LongPressMS != 900 {
		t.Fatalf("imported preset lost its mapping")
	}

	big := filepath.Join(t.TempDir(), "big.json")
	_ = os.WriteFile(big, make([]byte, maxImport+1), 0o644)
	d.open = big
	if _, err := a.ImportPreset(); err == nil {
		t.Fatalf("imported a huge file")
	}
}

func TestGetStateListsPresets(t *testing.T) {
	a, _ := testApp(t)
	b, _ := a.CreatePreset("B", presets.FromDefault)
	st := State{Presets: a.ListPresets(), ActivePreset: a.lib.ActiveID()}
	if len(st.Presets) != 2 || st.ActivePreset == b.ID {
		t.Fatalf("state = %+v", st)
	}
}

func TestPresetItems(t *testing.T) {
	if got := presetItems([]PresetInfo{{ID: "a", Name: "A", Active: true}}); got != nil {
		t.Fatalf("one preset made menu items: %+v", got)
	}
	got := presetItems([]PresetInfo{{ID: "a", Name: "A", Active: true}, {ID: "b", Name: "B"}})
	if len(got) != 3 || !got[0].Separator || got[1].ID != "preset:a" || !got[1].Checked || got[2].Checked {
		t.Fatalf("items = %+v", got)
	}
}
