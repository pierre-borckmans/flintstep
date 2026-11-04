package store

import (
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"

	"sparkbridge/internal/mapping"
)

// THE SETTINGS FILE: one JSON Config in the app's data dir.
//
// Loading never leaves the app without a mapping. A missing file is a first launch;
// a corrupt one is reported, but the pedal still works with the defaults meanwhile.
// Saving writes a temp file and renames it over the old one, so a crash mid-write
// leaves the previous settings, not half of the new ones.

// AppDirName is the data dir's name under the user config dir.
const AppDirName = "SparkX MIDI"

// Dir is the app's data dir (~/Library/Application Support/SparkX MIDI on macOS),
// created if needed.
func Dir() (string, error) {
	base, err := os.UserConfigDir()
	if err != nil {
		return "", fmt.Errorf("finding the settings folder: %w", err)
	}
	dir := filepath.Join(base, AppDirName)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", fmt.Errorf("creating %s: %w", dir, err)
	}
	return dir, nil
}

// Load reads the Config at path, normalized. A missing file is Default() and no
// error; an unreadable or corrupt one is Default() and an error saying why.
func Load(path string) (mapping.Config, error) {
	b, err := os.ReadFile(path)
	if errors.Is(err, fs.ErrNotExist) {
		return mapping.Default(), nil
	}
	if err != nil {
		return mapping.Default(), fmt.Errorf("reading settings: %w", err)
	}
	var c mapping.Config
	if err := json.Unmarshal(b, &c); err != nil {
		return mapping.Default(), fmt.Errorf("settings file %s is damaged, using defaults: %w", path, err)
	}
	return c.Normalize(), nil
}

// Save writes c to path atomically, creating the folder if needed.
func Save(path string, c mapping.Config) error {
	b, err := json.MarshalIndent(c, "", "  ")
	if err != nil {
		return fmt.Errorf("encoding settings: %w", err)
	}
	dir := filepath.Dir(path)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return fmt.Errorf("creating %s: %w", dir, err)
	}
	f, err := os.CreateTemp(dir, ".config-*.json")
	if err != nil {
		return fmt.Errorf("saving settings: %w", err)
	}
	tmp := f.Name()
	// Until the rename succeeds the temp file is litter; after it, this is a no-op.
	defer func() { _ = os.Remove(tmp) }()
	if _, err := f.Write(append(b, '\n')); err != nil {
		f.Close()
		return fmt.Errorf("saving settings: %w", err)
	}
	// Flush to disk before the rename, or a power cut can leave an empty file
	// behind the new name.
	if err := f.Sync(); err != nil {
		f.Close()
		return fmt.Errorf("saving settings: %w", err)
	}
	if err := f.Close(); err != nil {
		return fmt.Errorf("saving settings: %w", err)
	}
	if err := os.Rename(tmp, path); err != nil {
		return fmt.Errorf("saving settings: %w", err)
	}
	return nil
}
