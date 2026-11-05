package store

import (
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"

	"flintstep/internal/mapping"
	"flintstep/internal/product"
)

// THE SETTINGS FILE: one JSON Config in the app's data dir.
//
// Loading never leaves the app without a mapping. A missing file is a first launch;
// a corrupt one is reported, but the pedal still works with the defaults meanwhile.
// Saving writes a temp file and renames it over the old one, so a crash mid-write
// leaves the previous settings, not half of the new ones.

// AppDirName is the data dir's name under the user config dir.
const AppDirName = product.DataDirName

// Dir is the app's data dir (~/Library/Application Support/Flintstep on macOS),
// created if needed. The first call in a process moves the folder over from its old
// name if there is one (migrate.go). If that move failed, Dir is the old folder, so
// the user's presets still load, and the next launch tries the move again.
func Dir() (string, error) {
	base, err := os.UserConfigDir()
	if err != nil {
		return "", fmt.Errorf("finding the settings folder: %w", err)
	}
	migrateOnceIn(base)
	return dirIn(base, LastMigration())
}

// dirIn is Dir under base, after the migration m.
func dirIn(base string, m Migration) (string, error) {
	if m.Err != nil {
		return m.From, nil //nolint:nilerr // the failed move is logged; the old folder still works
	}
	dir := filepath.Join(base, AppDirName)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", fmt.Errorf("creating %s: %w", dir, err)
	}
	return dir, nil
}

// ExistingDir is the data dir for a reader that must not write: the new folder if it
// exists, else the old-named one if that exists (the app hasn't run since the rename),
// else the new folder's path, which then holds nothing. It creates and moves nothing.
func ExistingDir() (string, error) {
	base, err := os.UserConfigDir()
	if err != nil {
		return "", fmt.Errorf("finding the settings folder: %w", err)
	}
	return existingDirIn(base), nil
}

func existingDirIn(base string) string {
	dir := filepath.Join(base, AppDirName)
	if _, err := os.Stat(dir); err == nil {
		return dir
	}
	if fi, err := os.Stat(filepath.Join(base, LegacyDirName)); err == nil && fi.IsDir() {
		return filepath.Join(base, LegacyDirName)
	}
	return dir
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
	return WriteAtomic(path, append(b, '\n'))
}

// WriteAtomic writes b to path through a temp file in the same folder and a rename,
// creating the folder if needed. A crash mid-write leaves the old file, not half of
// the new one.
func WriteAtomic(path string, b []byte) error {
	dir := filepath.Dir(path)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return fmt.Errorf("creating %s: %w", dir, err)
	}
	f, err := os.CreateTemp(dir, "."+filepath.Base(path)+"-*")
	if err != nil {
		return fmt.Errorf("saving settings: %w", err)
	}
	tmp := f.Name()
	// Until the rename succeeds the temp file is litter; after it, this is a no-op.
	defer func() { _ = os.Remove(tmp) }()
	if _, err := f.Write(b); err != nil {
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
