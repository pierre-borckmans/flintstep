package presets

import (
	"bytes"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"flintstep/internal/mapping"
	"flintstep/internal/product"
	"flintstep/internal/store"
)

// THE PRESET LIBRARY: named mappings in one file, library.json, in the data dir.
//
// A preset is a name and one whole mapping.Config. The library never looks inside a
// Config beyond its pedal: it copies them whole, so a field added to Config is kept by
// presets, exports and imports without a change here. The remembered pedal is the one
// exception: it belongs to the Mac, not to a mapping, so it lives once at the top of the
// library, is zeroed in every stored preset and put back on the active one.
//
// Every change writes the whole file atomically and only then takes effect in memory, so
// a failed write leaves both the file and the library as they were.

const (
	FileName       = "library.json"
	LegacyFileName = "config.json" // the single mapping from before presets; read once, kept as a backup
	FileVersion    = 1

	MaxName     = 40
	DefaultName = "My mapping" // the first preset, and the one a config.json becomes
	NewName     = "New preset" // a preset created without a name
	untitled    = "Untitled"   // a stored preset whose name is missing

	FromCurrent = "current"
	FromDefault = "default"

	ExportFormat  = "flintstep-preset"
	ExportVersion = 1
	exportSuffix  = ".flintstep.json"

	// What exports were called before the rename to Flintstep. Import still takes them.
	legacyExportFormat = "sparkx-midi-preset"
	legacyExportSuffix = ".sparkx.json"
)

// Preset is one stored mapping. Times are unix milliseconds.
type Preset struct {
	ID        string         `json:"id"`
	Name      string         `json:"name"`
	Config    mapping.Config `json:"config"`
	CreatedAt int64          `json:"createdAt"`
	UpdatedAt int64          `json:"updatedAt"`
}

// Info is a preset as the UI lists it.
type Info struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	UpdatedAt int64  `json:"updatedAt"`
	Active    bool   `json:"active"`
}

type file struct {
	Version int              `json:"version"`
	Active  string           `json:"active"`
	Presets []Preset         `json:"presets"`
	Pedal   mapping.PedalRef `json:"pedal"`
}

// Library is safe for concurrent use.
type Library struct {
	mu   sync.Mutex
	path string
	f    file
	now  func() time.Time
}

// Open loads dir/library.json. Without one, a config.json there becomes the first
// preset (and its pedal the global one), and config.json stays as it was; without
// either, the library is one default preset. A library.json that cannot be read is
// renamed to library.json.corrupt-<time> and replaced by the default library: the
// returned Library is always usable, and the error says what happened.
func Open(dir string) (*Library, error) {
	l := &Library{path: filepath.Join(dir, FileName), now: time.Now}
	b, err := os.ReadFile(l.path)
	switch {
	case err == nil:
		f, perr := parse(b)
		if perr == nil {
			l.f = f
			l.repair()
			return l, nil
		}
		l.f = l.fresh(mapping.Default(), mapping.PedalRef{})
		aside := fmt.Sprintf("%s.corrupt-%s", l.path, l.now().Format("20060102-150405"))
		if rerr := os.Rename(l.path, aside); rerr != nil {
			return l, fmt.Errorf("preset library %s is damaged (%w) and could not be moved aside: %w", l.path, perr, rerr)
		}
		werr := l.write(l.f)
		return l, errors.Join(fmt.Errorf("preset library was damaged, using defaults; the old file is %s: %w", filepath.Base(aside), perr), werr)
	case errors.Is(err, fs.ErrNotExist):
		cfg, lerr := store.Load(filepath.Join(dir, LegacyFileName))
		l.f = l.fresh(cfg, cfg.Pedal)
		return l, errors.Join(lerr, l.write(l.f))
	default:
		l.f = l.fresh(mapping.Default(), mapping.PedalRef{})
		return l, fmt.Errorf("reading the preset library: %w", err)
	}
}

// ReadActive is the active preset's mapping with the global pedal, as Open would give
// it, without writing anything: for the command-line bridge, which must not touch the
// app's files. Without library.json it reads config.json.
func ReadActive(dir string) (mapping.Config, error) {
	b, err := os.ReadFile(filepath.Join(dir, FileName))
	if errors.Is(err, fs.ErrNotExist) {
		return store.Load(filepath.Join(dir, LegacyFileName))
	}
	if err != nil {
		return mapping.Default(), fmt.Errorf("reading the preset library: %w", err)
	}
	f, err := parse(b)
	if err != nil {
		return mapping.Default(), fmt.Errorf("preset library is damaged, using defaults: %w", err)
	}
	l := &Library{f: f, now: time.Now}
	l.repair()
	return l.activeLocked(), nil
}

func parse(b []byte) (file, error) {
	var f file
	if err := json.Unmarshal(b, &f); err != nil {
		return file{}, err
	}
	if f.Version == 0 && f.Presets == nil {
		return file{}, errors.New("not a preset library")
	}
	return f, nil
}

func (l *Library) fresh(cfg mapping.Config, pedal mapping.PedalRef) file {
	p := l.newPreset(DefaultName, cfg)
	return file{Version: FileVersion, Active: p.ID, Presets: []Preset{p}, Pedal: pedal}
}

func (l *Library) newPreset(name string, cfg mapping.Config) Preset {
	at := l.now().UnixMilli()
	return Preset{ID: newID(), Name: name, Config: stored(cfg), CreatedAt: at, UpdatedAt: at}
}

// repair makes a loaded file safe to use: unique ids, valid unique names, normalized
// configs without a pedal, at least one preset, an active one that exists.
func (l *Library) repair() {
	f := &l.f
	f.Version = FileVersion
	f.Pedal = normPedal(f.Pedal)
	seenID := map[string]bool{}
	var kept []Preset
	for _, p := range f.Presets {
		if p.ID == "" || seenID[p.ID] {
			p.ID = newID()
		}
		seenID[p.ID] = true
		name := truncate(strings.TrimSpace(p.Name), MaxName)
		if name == "" {
			name = untitled
		}
		p.Name = uniqueName(kept, name, "")
		p.Config = stored(p.Config)
		kept = append(kept, p)
	}
	f.Presets = kept
	if len(f.Presets) == 0 {
		f.Presets = []Preset{l.newPreset(DefaultName, mapping.Default())}
	}
	if index(f.Presets, f.Active) < 0 {
		f.Active = f.Presets[0].ID
	}
}

// stored is cfg as a preset keeps it: normalized, without the pedal, and a copy that
// shares nothing with the caller's.
func stored(cfg mapping.Config) mapping.Config {
	cfg = clone(cfg).Normalize()
	cfg.Pedal = mapping.PedalRef{}
	return cfg
}

// clone copies a Config through JSON: whatever Config holds, nothing is shared.
func clone(c mapping.Config) mapping.Config {
	b, err := json.Marshal(c)
	if err != nil {
		return c
	}
	var out mapping.Config
	if err := json.Unmarshal(b, &out); err != nil {
		return c
	}
	return out
}

func sameConfig(a, b mapping.Config) bool {
	ja, ea := json.Marshal(a)
	jb, eb := json.Marshal(b)
	return ea == nil && eb == nil && bytes.Equal(ja, jb)
}

func (f file) clone() file {
	out := f
	out.Presets = make([]Preset, len(f.Presets))
	copy(out.Presets, f.Presets)
	return out
}

func index(ps []Preset, id string) int {
	for i, p := range ps {
		if p.ID == id {
			return i
		}
	}
	return -1
}

func normPedal(p mapping.PedalRef) mapping.PedalRef {
	return mapping.PedalRef{Address: strings.TrimSpace(p.Address), Name: strings.TrimSpace(p.Name)}
}

func newID() string {
	var b [8]byte
	_, _ = rand.Read(b[:])
	return hex.EncodeToString(b[:])
}

// write saves f as the library file.
func (l *Library) write(f file) error {
	b, err := json.MarshalIndent(f, "", "  ")
	if err != nil {
		return fmt.Errorf("encoding the preset library: %w", err)
	}
	return store.WriteAtomic(l.path, append(b, '\n'))
}

// commit writes next and, if that worked, makes it the library.
func (l *Library) commit(next file) error {
	if err := l.write(next); err != nil {
		return err
	}
	l.f = next
	return nil
}

// Path is the library file.
func (l *Library) Path() string { return l.path }

// ActiveID is the active preset's id.
func (l *Library) ActiveID() string {
	l.mu.Lock()
	defer l.mu.Unlock()
	return l.f.Active
}

// Active is the active preset's mapping, with the global pedal.
func (l *Library) Active() mapping.Config {
	l.mu.Lock()
	defer l.mu.Unlock()
	return l.activeLocked()
}

func (l *Library) activeLocked() mapping.Config {
	c := clone(l.f.Presets[index(l.f.Presets, l.f.Active)].Config)
	c.Pedal = l.f.Pedal
	return c
}

// List is every preset in library order.
func (l *Library) List() []Info {
	l.mu.Lock()
	defer l.mu.Unlock()
	out := make([]Info, len(l.f.Presets))
	for i, p := range l.f.Presets {
		out[i] = l.info(p)
	}
	return out
}

func (l *Library) info(p Preset) Info {
	return Info{ID: p.ID, Name: p.Name, UpdatedAt: p.UpdatedAt, Active: p.ID == l.f.Active}
}

// Pedal is the remembered pedal.
func (l *Library) Pedal() mapping.PedalRef {
	l.mu.Lock()
	defer l.mu.Unlock()
	return l.f.Pedal
}

// SetPedal remembers p for every preset.
func (l *Library) SetPedal(p mapping.PedalRef) error {
	l.mu.Lock()
	defer l.mu.Unlock()
	p = normPedal(p)
	if p == l.f.Pedal {
		return nil
	}
	next := l.f.clone()
	next.Pedal = p
	return l.commit(next)
}

// SaveActive stores cfg as the active preset's mapping. Its pedal is ignored: SetPedal
// owns that.
func (l *Library) SaveActive(cfg mapping.Config) error {
	l.mu.Lock()
	defer l.mu.Unlock()
	return l.saveLocked(index(l.f.Presets, l.f.Active), cfg)
}

// SaveInto stores cfg as preset id's mapping, active or not. Its pedal is ignored.
func (l *Library) SaveInto(id string, cfg mapping.Config) error {
	l.mu.Lock()
	defer l.mu.Unlock()
	i := index(l.f.Presets, id)
	if i < 0 {
		return errNoPreset
	}
	return l.saveLocked(i, cfg)
}

// Has says whether preset id exists.
func (l *Library) Has(id string) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	return index(l.f.Presets, id) >= 0
}

// saveLocked stores cfg as preset i's mapping, with l.mu held.
func (l *Library) saveLocked(i int, cfg mapping.Config) error {
	cfg = stored(cfg)
	if sameConfig(cfg, l.f.Presets[i].Config) {
		return nil
	}
	next := l.f.clone()
	next.Presets[i].Config = cfg
	next.Presets[i].UpdatedAt = l.now().UnixMilli()
	return l.commit(next)
}

// Select makes preset id the active one and returns its mapping, with the global pedal.
func (l *Library) Select(id string) (mapping.Config, error) {
	l.mu.Lock()
	defer l.mu.Unlock()
	if index(l.f.Presets, id) < 0 {
		return l.activeLocked(), errNoPreset
	}
	if id != l.f.Active {
		next := l.f.clone()
		next.Active = id
		if err := l.commit(next); err != nil {
			return l.activeLocked(), err
		}
	}
	return l.activeLocked(), nil
}

var errNoPreset = errors.New("that preset no longer exists")

// Create adds a preset, a copy of the active one (FromCurrent) or the default mapping
// (FromDefault). A blank name picks "New preset", made unique. It does not activate it.
func (l *Library) Create(name, from string) (Info, error) {
	l.mu.Lock()
	defer l.mu.Unlock()
	var cfg mapping.Config
	switch from {
	case FromCurrent:
		cfg = l.f.Presets[index(l.f.Presets, l.f.Active)].Config
	case FromDefault:
		cfg = mapping.Default()
	default:
		return Info{}, fmt.Errorf("unknown preset source %q", from)
	}
	if strings.TrimSpace(name) == "" {
		name = uniqueName(l.f.Presets, NewName, "")
	} else {
		n, err := l.checkName(name, "")
		if err != nil {
			return Info{}, err
		}
		name = n
	}
	return l.add(name, cfg)
}

func (l *Library) add(name string, cfg mapping.Config) (Info, error) {
	p := l.newPreset(name, cfg)
	next := l.f.clone()
	next.Presets = append(next.Presets, p)
	if err := l.commit(next); err != nil {
		return Info{}, err
	}
	return l.info(p), nil
}

// Rename gives preset id a new name.
func (l *Library) Rename(id, name string) error {
	l.mu.Lock()
	defer l.mu.Unlock()
	i := index(l.f.Presets, id)
	if i < 0 {
		return errNoPreset
	}
	n, err := l.checkName(name, id)
	if err != nil {
		return err
	}
	if n == l.f.Presets[i].Name {
		return nil
	}
	next := l.f.clone()
	next.Presets[i].Name = n
	next.Presets[i].UpdatedAt = l.now().UnixMilli()
	return l.commit(next)
}

// Duplicate adds a copy of preset id named "<name> copy", made unique. It does not
// activate it.
func (l *Library) Duplicate(id string) (Info, error) {
	l.mu.Lock()
	defer l.mu.Unlock()
	i := index(l.f.Presets, id)
	if i < 0 {
		return Info{}, errNoPreset
	}
	src := l.f.Presets[i]
	const suffix = " copy"
	base := truncate(src.Name, MaxName-utf8.RuneCountInString(suffix)) + suffix
	return l.add(uniqueName(l.f.Presets, base, ""), src.Config)
}

// Delete removes preset id. The last preset cannot go. Deleting the active one
// activates its neighbour: the next one, or the previous one if it was last.
func (l *Library) Delete(id string) error {
	l.mu.Lock()
	defer l.mu.Unlock()
	i := index(l.f.Presets, id)
	if i < 0 {
		return errNoPreset
	}
	if len(l.f.Presets) == 1 {
		return errors.New("the last preset cannot be deleted")
	}
	next := l.f.clone()
	next.Presets = append(next.Presets[:i:i], next.Presets[i+1:]...)
	if id == l.f.Active {
		next.Active = next.Presets[min(i, len(next.Presets)-1)].ID
	}
	return l.commit(next)
}

// checkName is name trimmed, if it is 1..MaxName characters and no other preset (any
// but self) has it, whatever the case.
func (l *Library) checkName(name, self string) (string, error) {
	n, err := CleanName(name)
	if err != nil {
		return "", err
	}
	if taken(l.f.Presets, n, self) {
		return "", fmt.Errorf("a preset named %q already exists", n)
	}
	return n, nil
}

// CleanName is name trimmed, or an error if that is empty or over MaxName characters.
func CleanName(name string) (string, error) {
	n := strings.TrimSpace(name)
	switch {
	case n == "":
		return "", errors.New("a preset needs a name")
	case utf8.RuneCountInString(n) > MaxName:
		return "", fmt.Errorf("preset names are at most %d characters", MaxName)
	}
	return n, nil
}

func taken(ps []Preset, name, self string) bool {
	for _, p := range ps {
		if p.ID != self && strings.EqualFold(p.Name, name) {
			return true
		}
	}
	return false
}

// uniqueName is base, or "base (2)", "base (3)"... the first that no preset but self
// has, with base cut so the whole stays within MaxName.
func uniqueName(ps []Preset, base, self string) string {
	if !taken(ps, base, self) {
		return base
	}
	for n := 2; ; n++ {
		suffix := fmt.Sprintf(" (%d)", n)
		name := truncate(base, MaxName-utf8.RuneCountInString(suffix)) + suffix
		if !taken(ps, name, self) {
			return name
		}
	}
}

func truncate(s string, n int) string {
	r := []rune(s)
	if len(r) <= n {
		return s
	}
	return strings.TrimSpace(string(r[:n]))
}

// ---- export and import ----

type exportFile struct {
	Format  string          `json:"format"`
	Version int             `json:"version"`
	Name    string          `json:"name"`
	Config  json.RawMessage `json:"config"`
}

// Export is preset id as a file to share, and the file name to suggest. The pedal is
// left out: it is this Mac's, not the mapping's.
func (l *Library) Export(id string) ([]byte, string, error) {
	l.mu.Lock()
	p, ok := Preset{}, false
	if i := index(l.f.Presets, id); i >= 0 {
		p, ok = l.f.Presets[i], true
	}
	l.mu.Unlock()
	if !ok {
		return nil, "", errNoPreset
	}
	cfg, err := withoutPedal(p.Config)
	if err != nil {
		return nil, "", err
	}
	b, err := json.MarshalIndent(exportFile{Format: ExportFormat, Version: ExportVersion, Name: p.Name, Config: cfg}, "", "  ")
	if err != nil {
		return nil, "", fmt.Errorf("encoding the preset: %w", err)
	}
	return append(b, '\n'), ExportFileName(p.Name), nil
}

// withoutPedal is cfg's JSON with the "pedal" key removed, every other field as it is.
func withoutPedal(cfg mapping.Config) (json.RawMessage, error) {
	b, err := json.Marshal(cfg)
	if err != nil {
		return nil, fmt.Errorf("encoding the preset: %w", err)
	}
	var m map[string]json.RawMessage
	if err := json.Unmarshal(b, &m); err != nil {
		return nil, fmt.Errorf("encoding the preset: %w", err)
	}
	delete(m, "pedal")
	b, err = json.MarshalIndent(m, "  ", "  ")
	if err != nil {
		return nil, fmt.Errorf("encoding the preset: %w", err)
	}
	return b, nil
}

// ExportFileName is "<name>.flintstep.json" with the characters Finder or the shell
// trip over replaced.
func ExportFileName(name string) string {
	n := strings.Map(func(r rune) rune {
		switch {
		case r == '/' || r == ':' || r == '\\':
			return '-'
		case r < 0x20:
			return -1
		}
		return r
	}, name)
	n = strings.TrimLeft(strings.TrimSpace(n), ".")
	if n == "" {
		n = "preset"
	}
	return n + exportSuffix
}

// Import adds the preset in data and returns it; it does not activate it. data is an
// exported preset, or a bare Config such as an old config.json, named after filename.
// The config is normalized and must validate; its pedal is dropped. A name another
// preset has gets " (2)".
func (l *Library) Import(data []byte, filename string) (Info, error) {
	name, cfg, err := decode(data)
	if err != nil {
		return Info{}, err
	}
	cfg = cfg.Normalize()
	if err := cfg.Validate(); err != nil {
		return Info{}, fmt.Errorf("the preset cannot be used: %w", err)
	}
	name = truncate(strings.TrimSpace(name), MaxName)
	if name == "" {
		name = truncate(nameFromFile(filename), MaxName)
	}
	if name == "" {
		name = "Imported preset"
	}
	l.mu.Lock()
	defer l.mu.Unlock()
	return l.add(uniqueName(l.f.Presets, name, ""), cfg)
}

const notAPreset = "this file is not a " + product.Name + " preset"

func decode(data []byte) (string, mapping.Config, error) {
	var top map[string]json.RawMessage
	if err := json.Unmarshal(data, &top); err != nil || len(top) == 0 {
		return "", mapping.Config{}, errors.New(notAPreset)
	}
	if _, ok := top["format"]; ok {
		var head exportFile
		if err := json.Unmarshal(data, &head); err != nil {
			return "", mapping.Config{}, errors.New(notAPreset)
		}
		if head.Format != ExportFormat && head.Format != legacyExportFormat {
			return "", mapping.Config{}, errors.New(notAPreset)
		}
		if head.Version > ExportVersion {
			return "", mapping.Config{}, errors.New("this preset was made by a newer " + product.Name + "; update the app to import it")
		}
		if len(head.Config) == 0 || string(head.Config) == "null" {
			return "", mapping.Config{}, errors.New("this preset file has no mapping in it")
		}
		// Lenient here: the format says it is a preset, and one from a later version of
		// the same format may carry fields this one does not know.
		var cfg mapping.Config
		if err := json.Unmarshal(head.Config, &cfg); err != nil {
			return "", mapping.Config{}, fmt.Errorf("this preset file is damaged: %w", err)
		}
		return head.Name, cfg, nil
	}
	cfg, err := strictConfig(data)
	if err != nil {
		return "", mapping.Config{}, errors.New(notAPreset)
	}
	return "", cfg, nil
}

// strictConfig decodes a Config, refusing keys a Config does not have: that is what
// tells a bare config.json from any other JSON.
func strictConfig(b []byte) (mapping.Config, error) {
	dec := json.NewDecoder(bytes.NewReader(b))
	dec.DisallowUnknownFields()
	var c mapping.Config
	if err := dec.Decode(&c); err != nil {
		return mapping.Config{}, err
	}
	return c, nil
}

func nameFromFile(path string) string {
	base := filepath.Base(path)
	if base == "." || base == string(filepath.Separator) {
		return ""
	}
	lower := strings.ToLower(base)
	switch {
	case strings.HasSuffix(lower, exportSuffix):
		base = base[:len(base)-len(exportSuffix)]
	case strings.HasSuffix(lower, legacyExportSuffix):
		base = base[:len(base)-len(legacyExportSuffix)]
	case strings.HasSuffix(lower, ".json"):
		base = base[:len(base)-len(".json")]
	}
	return strings.TrimSpace(base)
}
