package presets

import (
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	"sparkbridge/internal/mapping"
	"sparkbridge/internal/store"
)

var pedal = mapping.PedalRef{Address: "4F1A", Name: "SparkX v4.1.23 fbfc"}

func custom() mapping.Config {
	c := mapping.Default()
	c.Switches[0].Tap.Number = 20
	c.LEDMode = mapping.LEDFeedback
	return c.Normalize()
}

func open(t *testing.T, dir string) *Library {
	t.Helper()
	l, err := Open(dir)
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	return l
}

func reopen(t *testing.T, l *Library) *Library {
	t.Helper()
	return open(t, filepath.Dir(l.Path()))
}

func names(l *Library) []string {
	var out []string
	for _, p := range l.List() {
		out = append(out, p.Name)
	}
	return out
}

func activeName(l *Library) string {
	for _, p := range l.List() {
		if p.Active {
			return p.Name
		}
	}
	return ""
}

func TestFirstLaunchIsOneDefaultPreset(t *testing.T) {
	dir := t.TempDir()
	l := open(t, dir)
	if got := names(l); !reflect.DeepEqual(got, []string{DefaultName}) {
		t.Fatalf("presets = %v", got)
	}
	if !sameConfig(l.Active(), mapping.Default()) {
		t.Fatalf("active is not the default mapping")
	}
	if _, err := os.Stat(filepath.Join(dir, FileName)); err != nil {
		t.Fatalf("library not written: %v", err)
	}
}

func TestMigratesConfigJSON(t *testing.T) {
	dir := t.TempDir()
	old := custom()
	old.Pedal = pedal
	legacy := filepath.Join(dir, LegacyFileName)
	if err := store.Save(legacy, old); err != nil {
		t.Fatal(err)
	}
	before, _ := os.ReadFile(legacy)

	l := open(t, dir)
	if got := names(l); !reflect.DeepEqual(got, []string{DefaultName}) {
		t.Fatalf("presets = %v", got)
	}
	if l.Pedal() != pedal {
		t.Fatalf("pedal = %+v, want %+v", l.Pedal(), pedal)
	}
	if !sameConfig(l.Active(), old) {
		t.Fatalf("active config differs from config.json")
	}
	after, err := os.ReadFile(legacy)
	if err != nil || string(after) != string(before) {
		t.Fatalf("config.json was touched (err %v)", err)
	}

	// The preset itself does not carry the pedal.
	raw, _ := os.ReadFile(filepath.Join(dir, FileName))
	var f struct {
		Presets []struct {
			Config mapping.Config `json:"config"`
		} `json:"presets"`
	}
	if err := json.Unmarshal(raw, &f); err != nil {
		t.Fatal(err)
	}
	if f.Presets[0].Config.Pedal != (mapping.PedalRef{}) {
		t.Fatalf("preset stored the pedal: %+v", f.Presets[0].Config.Pedal)
	}

	// Once library.json exists, config.json is ignored.
	_ = store.Save(legacy, mapping.Default())
	if !sameConfig(reopen(t, l).Active(), old) {
		t.Fatalf("config.json read again after migration")
	}
}

func TestCorruptLibraryIsKeptAside(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, FileName)
	if err := os.WriteFile(path, []byte("{not json"), 0o644); err != nil {
		t.Fatal(err)
	}
	l, err := Open(dir)
	if err == nil || !strings.Contains(err.Error(), "damaged") {
		t.Fatalf("err = %v, want a damaged-file error", err)
	}
	if l == nil || !sameConfig(l.Active(), mapping.Default()) {
		t.Fatalf("no usable default library")
	}
	matches, _ := filepath.Glob(filepath.Join(dir, FileName+".corrupt-*"))
	if len(matches) != 1 {
		t.Fatalf("corrupt copies = %v, want one", matches)
	}
	if b, _ := os.ReadFile(matches[0]); string(b) != "{not json" {
		t.Fatalf("corrupt copy holds %q", b)
	}
	if _, err := os.Stat(path); err != nil {
		t.Fatalf("no fresh library written: %v", err)
	}
}

func TestOpenRepairs(t *testing.T) {
	dir := t.TempDir()
	cfg := custom()
	cfg.Pedal = pedal // a preset that somehow kept a pedal: dropped, the global one wins
	f := map[string]any{
		"version": 1,
		"active":  "gone",
		"pedal":   mapping.PedalRef{Name: "global"},
		"presets": []map[string]any{
			{"id": "a", "name": "  Live  ", "config": cfg},
			{"id": "a", "name": "live", "config": mapping.Default()},
			{"id": "", "name": "", "config": mapping.Default()},
		},
	}
	b, _ := json.Marshal(f)
	if err := os.WriteFile(filepath.Join(dir, FileName), b, 0o644); err != nil {
		t.Fatal(err)
	}
	l := open(t, dir)
	list := l.List()
	if len(list) != 3 {
		t.Fatalf("presets = %v", names(l))
	}
	ids := map[string]bool{}
	for _, p := range list {
		if p.ID == "" || ids[p.ID] {
			t.Fatalf("ids not unique: %+v", list)
		}
		ids[p.ID] = true
	}
	if got := names(l); !reflect.DeepEqual(got, []string{"Live", "live (2)", "Untitled"}) {
		t.Fatalf("names = %v", got)
	}
	if activeName(l) != "Live" {
		t.Fatalf("active = %q, want the first preset when the saved one is gone", activeName(l))
	}
	if l.Active().Pedal.Name != "global" {
		t.Fatalf("active pedal = %+v, want the global one", l.Active().Pedal)
	}
}

func TestEmptyLibraryGetsAPreset(t *testing.T) {
	dir := t.TempDir()
	_ = os.WriteFile(filepath.Join(dir, FileName), []byte(`{"version":1,"presets":[]}`), 0o644)
	l := open(t, dir)
	if len(l.List()) != 1 || l.ActiveID() == "" {
		t.Fatalf("presets = %+v", l.List())
	}
}

func TestSaveActiveWritesIntoTheActivePreset(t *testing.T) {
	l := open(t, t.TempDir())
	first := l.ActiveID()
	other, err := l.Create("Other", FromDefault)
	if err != nil {
		t.Fatal(err)
	}
	c := custom()
	c.Pedal = pedal
	if err := l.SaveActive(c); err != nil {
		t.Fatal(err)
	}
	if _, err := l.Select(other.ID); err != nil {
		t.Fatal(err)
	}
	if !sameConfig(l.Active(), mapping.Default()) {
		t.Fatalf("the other preset changed")
	}
	got, err := l.Select(first)
	if err != nil {
		t.Fatal(err)
	}
	c.Pedal = mapping.PedalRef{} // SaveActive does not set the global pedal
	if !sameConfig(got, c) {
		t.Fatalf("Select returned %+v", got)
	}
	if !sameConfig(reopen(t, l).Active(), c) {
		t.Fatalf("not persisted")
	}
}

func TestPedalIsGlobal(t *testing.T) {
	l := open(t, t.TempDir())
	if err := l.SetPedal(pedal); err != nil {
		t.Fatal(err)
	}
	b, err := l.Create("B", FromCurrent)
	if err != nil {
		t.Fatal(err)
	}
	got, err := l.Select(b.ID)
	if err != nil {
		t.Fatal(err)
	}
	if got.Pedal != pedal {
		t.Fatalf("selected preset pedal = %+v", got.Pedal)
	}
	if r := reopen(t, l); r.Pedal() != pedal || r.Active().Pedal != pedal {
		t.Fatalf("pedal not kept: %+v", r.Pedal())
	}
	data, _, err := l.Export(b.ID)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(data), pedal.Address) || strings.Contains(string(data), `"pedal"`) {
		t.Fatalf("export carries the pedal:\n%s", data)
	}
}

func TestCreate(t *testing.T) {
	l := open(t, t.TempDir())
	c := custom()
	_ = l.SaveActive(c)

	cur, err := l.Create("From current", FromCurrent)
	if err != nil {
		t.Fatal(err)
	}
	if cur.Active {
		t.Fatalf("Create activated the new preset")
	}
	if got, _ := l.Select(cur.ID); !sameConfig(got, c) {
		t.Fatalf("from current is not a copy")
	}
	def, err := l.Create("Blank", FromDefault)
	if err != nil {
		t.Fatal(err)
	}
	if got, _ := l.Select(def.ID); !sameConfig(got, mapping.Default()) {
		t.Fatalf("from default is not the default")
	}
	auto, err := l.Create("", FromDefault)
	if err != nil || auto.Name != NewName {
		t.Fatalf("auto name = %q, %v", auto.Name, err)
	}
	auto2, _ := l.Create("  ", FromDefault)
	if auto2.Name != NewName+" (2)" {
		t.Fatalf("second auto name = %q", auto2.Name)
	}
	if _, err := l.Create("x", "elsewhere"); err == nil {
		t.Fatalf("unknown source accepted")
	}
}

func TestNames(t *testing.T) {
	l := open(t, t.TempDir())
	a, _ := l.Create("Ableton live", FromDefault)
	cases := []struct {
		name, wantErr string
	}{
		{"ableton LIVE", "already"},
		{" Ableton live ", "already"},
		{strings.Repeat("x", MaxName+1), "40"},
		{strings.Repeat("é", MaxName), ""},
	}
	for _, c := range cases {
		_, err := l.Create(c.name, FromDefault)
		if c.wantErr == "" && err != nil {
			t.Errorf("Create(%q): %v", c.name, err)
		}
		if c.wantErr != "" && (err == nil || !strings.Contains(err.Error(), c.wantErr)) {
			t.Errorf("Create(%q) = %v, want %q", c.name, err, c.wantErr)
		}
	}
	if err := l.Rename(a.ID, "  Logic  "); err != nil {
		t.Fatal(err)
	}
	if err := l.Rename(a.ID, "LOGIC"); err != nil {
		t.Fatalf("renaming to a different case of its own name: %v", err)
	}
	if err := l.Rename(a.ID, DefaultName); err == nil {
		t.Fatalf("rename onto another preset's name accepted")
	}
	if err := l.Rename(a.ID, ""); err == nil {
		t.Fatalf("empty name accepted")
	}
	if err := l.Rename("nope", "x"); err == nil {
		t.Fatalf("rename of a missing preset accepted")
	}
	if !contains(names(reopen(t, l)), "LOGIC") {
		t.Fatalf("rename not persisted: %v", names(l))
	}
}

func contains(s []string, v string) bool {
	for _, x := range s {
		if x == v {
			return true
		}
	}
	return false
}

func TestDuplicate(t *testing.T) {
	l := open(t, t.TempDir())
	c := custom()
	_ = l.SaveActive(c)
	id := l.ActiveID()
	d, err := l.Duplicate(id)
	if err != nil {
		t.Fatal(err)
	}
	if d.Name != DefaultName+" copy" || d.Active {
		t.Fatalf("duplicate = %+v", d)
	}
	d2, _ := l.Duplicate(id)
	if d2.Name != DefaultName+" copy (2)" {
		t.Fatalf("second duplicate = %q", d2.Name)
	}
	if got, _ := l.Select(d.ID); !sameConfig(got, c) {
		t.Fatalf("duplicate config differs")
	}
	long, _ := l.Create(strings.Repeat("y", MaxName), FromDefault)
	d3, err := l.Duplicate(long.ID)
	if err != nil || len([]rune(d3.Name)) > MaxName || !strings.HasSuffix(d3.Name, " copy") {
		t.Fatalf("duplicate of a 40-char name = %q, %v", d3.Name, err)
	}
}

func TestDelete(t *testing.T) {
	l := open(t, t.TempDir())
	if err := l.Delete(l.ActiveID()); err == nil {
		t.Fatalf("deleted the last preset")
	}
	b, _ := l.Create("B", FromDefault)
	c, _ := l.Create("C", FromDefault)

	// Deleting the active one activates its neighbour: the next, or the previous at the end.
	if _, err := l.Select(b.ID); err != nil {
		t.Fatal(err)
	}
	if err := l.Delete(b.ID); err != nil {
		t.Fatal(err)
	}
	if l.ActiveID() != c.ID {
		t.Fatalf("active = %q, want C", activeName(l))
	}
	if err := l.Delete(c.ID); err != nil {
		t.Fatal(err)
	}
	if activeName(l) != DefaultName {
		t.Fatalf("active = %q, want the previous one", activeName(l))
	}
	// Deleting another one leaves the active alone.
	d, _ := l.Create("D", FromDefault)
	active := l.ActiveID()
	if err := l.Delete(d.ID); err != nil || l.ActiveID() != active {
		t.Fatalf("delete of an inactive preset moved the active one (%v)", err)
	}
	if err := l.Delete("nope"); err == nil {
		t.Fatalf("delete of a missing preset accepted")
	}
	if got := names(reopen(t, l)); !reflect.DeepEqual(got, []string{DefaultName}) {
		t.Fatalf("after reopen: %v", got)
	}
}

func TestSelectMissing(t *testing.T) {
	l := open(t, t.TempDir())
	if _, err := l.Select("nope"); err == nil {
		t.Fatalf("selected a missing preset")
	}
}

func TestExportImportRoundTrip(t *testing.T) {
	l := open(t, t.TempDir())
	c := custom()
	_ = l.SaveActive(c)
	_ = l.Rename(l.ActiveID(), "Ableton live")

	data, file, err := l.Export(l.ActiveID())
	if err != nil {
		t.Fatal(err)
	}
	if file != "Ableton live.sparkx.json" {
		t.Fatalf("file name = %q", file)
	}
	var head struct {
		Format  string          `json:"format"`
		Version int             `json:"version"`
		Name    string          `json:"name"`
		Config  json.RawMessage `json:"config"`
	}
	if err := json.Unmarshal(data, &head); err != nil {
		t.Fatal(err)
	}
	if head.Format != ExportFormat || head.Version != ExportVersion || head.Name != "Ableton live" || len(head.Config) == 0 {
		t.Fatalf("export head = %+v", head)
	}

	other := open(t, t.TempDir())
	info, err := other.Import(data, "whatever.json")
	if err != nil {
		t.Fatal(err)
	}
	if info.Name != "Ableton live" || info.Active {
		t.Fatalf("imported = %+v", info)
	}
	if got, _ := other.Select(info.ID); !sameConfig(got, c) {
		t.Fatalf("round trip changed the config")
	}

	// Again into the library it came from: the name clashes.
	again, err := l.Import(data, "x.json")
	if err != nil || again.Name != "Ableton live (2)" {
		t.Fatalf("clash = %q, %v", again.Name, err)
	}
}

func TestImportBareConfig(t *testing.T) {
	l := open(t, t.TempDir())
	old := custom()
	old.Pedal = pedal
	b, _ := json.MarshalIndent(old, "", "  ")
	info, err := l.Import(b, "/Users/me/Downloads/config.json")
	if err != nil {
		t.Fatal(err)
	}
	if info.Name != "config" {
		t.Fatalf("name = %q, want the file's name", info.Name)
	}
	got, _ := l.Select(info.ID)
	old.Pedal = mapping.PedalRef{}
	if !sameConfig(got, old) {
		t.Fatalf("bare import changed the config")
	}
	if l.Pedal() == pedal {
		t.Fatalf("a bare import set the global pedal")
	}
	named, err := l.Import(b, "/tmp/Gig set.sparkx.json")
	if err != nil || named.Name != "Gig set" {
		t.Fatalf("name = %q, %v", named.Name, err)
	}
}

func TestImportRejects(t *testing.T) {
	l := open(t, t.TempDir())
	bad := mapping.Default()
	bad.Combos = []mapping.Combo{{A: 0, B: 0, Action: mapping.Action{Kind: mapping.KindCC}}}
	badCfg, _ := json.Marshal(bad)
	cases := map[string]string{
		"not json":       `{oops`,
		"array":          `[1,2]`,
		"empty object":   `{}`,
		"other app":      `{"hello": "world"}`,
		"other format":   `{"format": "something-else", "version": 1, "config": {}}`,
		"newer version":  `{"format": "sparkx-midi-preset", "version": 99, "name": "x", "config": {}}`,
		"no config":      `{"format": "sparkx-midi-preset", "version": 1, "name": "x"}`,
		"invalid config": `{"format": "sparkx-midi-preset", "version": 1, "name": "x", "config": ` + string(badCfg) + `}`,
	}
	for name, data := range cases {
		if _, err := l.Import([]byte(data), "x.json"); err == nil {
			t.Errorf("%s: imported", name)
		}
	}
	if len(l.List()) != 1 {
		t.Fatalf("a rejected import left a preset behind: %v", names(l))
	}
}

func TestImportNames(t *testing.T) {
	l := open(t, t.TempDir())
	mk := func(name string) []byte {
		b, _ := json.Marshal(map[string]any{"format": ExportFormat, "version": 1, "name": name, "config": mapping.Default()})
		return b
	}
	got, _ := l.Import(mk(strings.Repeat("z", 60)), "x.json")
	if len([]rune(got.Name)) != MaxName {
		t.Fatalf("long name kept %d chars", len([]rune(got.Name)))
	}
	got, _ = l.Import(mk("   "), "Night.sparkx.json")
	if got.Name != "Night" {
		t.Fatalf("blank name = %q, want the file's", got.Name)
	}
}

func TestExportFileName(t *testing.T) {
	cases := map[string]string{
		"Ableton live": "Ableton live.sparkx.json",
		"A/B: test":    "A-B- test.sparkx.json",
		".hidden":      "hidden.sparkx.json",
	}
	for in, want := range cases {
		if got := ExportFileName(in); got != want {
			t.Errorf("ExportFileName(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestReadActiveWritesNothing(t *testing.T) {
	dir := t.TempDir()
	old := custom()
	old.Pedal = pedal
	_ = store.Save(filepath.Join(dir, LegacyFileName), old)
	got, err := ReadActive(dir)
	if err != nil || !sameConfig(got, old) {
		t.Fatalf("from config.json: %v", err)
	}
	if _, err := os.Stat(filepath.Join(dir, FileName)); err == nil {
		t.Fatalf("ReadActive wrote a library")
	}

	l := open(t, dir)
	b, _ := l.Create("B", FromDefault)
	_, _ = l.Select(b.ID)
	got, err = ReadActive(dir)
	if err != nil || !sameConfig(got, l.Active()) || got.Pedal != pedal {
		t.Fatalf("from library.json: %+v, %v", got.Pedal, err)
	}
}

func TestFailedWriteChangesNothing(t *testing.T) {
	dir := t.TempDir()
	l := open(t, dir)
	// A directory where the library file goes makes every rename fail.
	path := l.Path()
	_ = os.Remove(path)
	if err := os.Mkdir(path, 0o755); err != nil {
		t.Fatal(err)
	}
	if _, err := l.Create("B", FromDefault); err == nil {
		t.Fatalf("create succeeded with an unwritable library")
	}
	if len(l.List()) != 1 {
		t.Fatalf("memory changed after a failed write: %v", names(l))
	}
}
