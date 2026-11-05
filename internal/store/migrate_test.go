package store

import (
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

// oldData writes a data folder under its old name in base and returns its files.
func oldData(t *testing.T, base string) map[string]string {
	t.Helper()
	files := map[string]string{
		"library.json":       `{"version":1}`,
		"config.json":        `{"longPressMs":900}`,
		"prefs.json":         `{"theme":"dark"}`,
		"app.log":            "---- starting ----\n",
		"logs/ble-trace.log": "trace\n",
	}
	for name, body := range files {
		p := filepath.Join(base, LegacyDirName, name)
		if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(p, []byte(body), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	return files
}

func sameFiles(t *testing.T, dir string, want map[string]string) {
	t.Helper()
	for name, body := range want {
		b, err := os.ReadFile(filepath.Join(dir, name))
		if err != nil || string(b) != body {
			t.Errorf("%s: %q, %v; want %q", name, b, err, body)
		}
	}
}

func gone(t *testing.T, path string) {
	t.Helper()
	if _, err := os.Lstat(path); !os.IsNotExist(err) {
		t.Errorf("%s still there: %v", path, err)
	}
}

func TestMigrateMovesOldFolder(t *testing.T) {
	base := t.TempDir()
	files := oldData(t, base)
	m := MigrateLegacy(base)
	if !m.Moved || m.Err != nil || m.Leftover != nil {
		t.Fatalf("got %+v", m)
	}
	sameFiles(t, filepath.Join(base, AppDirName), files)
	gone(t, filepath.Join(base, LegacyDirName))
	if !strings.Contains(m.String(), "moved") {
		t.Errorf("log line %q", m.String())
	}
	// No temp folder left behind.
	ents, _ := os.ReadDir(base)
	if len(ents) != 1 {
		t.Errorf("base holds %v, want only %s", ents, AppDirName)
	}
	// Twice is a no-op.
	if m := MigrateLegacy(base); m.Moved || m.Err != nil || m.String() != "" {
		t.Fatalf("second run: %+v", m)
	}
}

func TestMigrateLeavesExistingNewFolder(t *testing.T) {
	base := t.TempDir()
	oldData(t, base)
	newDir := filepath.Join(base, AppDirName)
	if err := os.Mkdir(newDir, 0o755); err != nil {
		t.Fatal(err)
	}
	if m := MigrateLegacy(base); m.Moved || m.Err != nil {
		t.Fatalf("got %+v", m)
	}
	if _, err := os.Stat(filepath.Join(base, LegacyDirName, "library.json")); err != nil {
		t.Fatal("old folder touched:", err)
	}
	if ents, _ := os.ReadDir(newDir); len(ents) != 0 {
		t.Fatalf("new folder got %v", ents)
	}
}

func TestMigrateNothingToMove(t *testing.T) {
	base := t.TempDir()
	if m := MigrateLegacy(base); m.Moved || m.Err != nil || m.String() != "" {
		t.Fatalf("got %+v", m)
	}
	gone(t, filepath.Join(base, AppDirName))
	// A file with the old name is not a data folder.
	if err := os.WriteFile(filepath.Join(base, LegacyDirName), nil, 0o644); err != nil {
		t.Fatal(err)
	}
	if m := MigrateLegacy(base); m.Moved || m.Err != nil {
		t.Fatalf("got %+v", m)
	}
}

func TestMigrateCopyFailureKeepsOldFolder(t *testing.T) {
	if runtime.GOOS == "windows" || os.Geteuid() == 0 {
		t.Skip("needs file permissions that bind")
	}
	base := t.TempDir()
	files := oldData(t, base)
	locked := filepath.Join(base, LegacyDirName, "library.json")
	if err := os.Chmod(locked, 0o000); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.Chmod(locked, 0o644) })

	m := MigrateLegacy(base)
	if m.Moved || m.Err == nil {
		t.Fatalf("got %+v, want an error", m)
	}
	if !strings.Contains(m.String(), "kept the old folder") {
		t.Errorf("log line %q", m.String())
	}
	gone(t, filepath.Join(base, AppDirName))
	ents, _ := os.ReadDir(base)
	if len(ents) != 1 {
		t.Errorf("base holds %v, want only the old folder", ents)
	}
	_ = os.Chmod(locked, 0o644)
	sameFiles(t, filepath.Join(base, LegacyDirName), files)

	// That run uses the old folder; the next one moves it.
	if dir, err := dirIn(base, m); err != nil || dir != filepath.Join(base, LegacyDirName) {
		t.Fatalf("dirIn after a failed move = %s, %v", dir, err)
	}
	if m := MigrateLegacy(base); !m.Moved {
		t.Fatalf("retry: %+v", m)
	}
	sameFiles(t, filepath.Join(base, AppDirName), files)
}

func TestMigrateCannotWriteBase(t *testing.T) {
	if runtime.GOOS == "windows" || os.Geteuid() == 0 {
		t.Skip("needs file permissions that bind")
	}
	base := t.TempDir()
	oldData(t, base)
	if err := os.Chmod(base, 0o555); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.Chmod(base, 0o755) })
	if m := MigrateLegacy(base); m.Moved || m.Err == nil {
		t.Fatalf("got %+v, want an error", m)
	}
	if _, err := os.Stat(filepath.Join(base, LegacyDirName, "library.json")); err != nil {
		t.Fatal("old folder damaged:", err)
	}
}

func TestDirInCreatesNewFolder(t *testing.T) {
	base := t.TempDir()
	dir, err := dirIn(base, Migration{})
	if err != nil || dir != filepath.Join(base, AppDirName) {
		t.Fatalf("dirIn = %s, %v", dir, err)
	}
	if fi, err := os.Stat(dir); err != nil || !fi.IsDir() {
		t.Fatalf("not created: %v", err)
	}
}

func TestExistingDir(t *testing.T) {
	base := t.TempDir()
	newDir, oldDir := filepath.Join(base, AppDirName), filepath.Join(base, LegacyDirName)
	if got := existingDirIn(base); got != newDir {
		t.Fatalf("nothing there: %s, want %s", got, newDir)
	}
	gone(t, newDir) // reading creates nothing
	oldData(t, base)
	if got := existingDirIn(base); got != oldDir {
		t.Fatalf("only the old folder: %s, want %s", got, oldDir)
	}
	if err := os.Mkdir(newDir, 0o755); err != nil {
		t.Fatal(err)
	}
	if got := existingDirIn(base); got != newDir {
		t.Fatalf("both: %s, want %s", got, newDir)
	}
}
