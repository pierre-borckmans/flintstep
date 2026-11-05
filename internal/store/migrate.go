package store

import (
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"sync"

	"flintstep/internal/product"
)

// THE MOVE FROM THE OLD NAME. The app was called SparkX MIDI and kept its data in
// ~/Library/Application Support/SparkX MIDI. On the first launch as Flintstep, if the
// new folder doesn't exist and the old one does, the old one's contents move over:
// copied into a temp folder next to it, renamed into place, and only then the old one
// removed. Any error before the rename leaves the old folder as it was and no new one:
// that run keeps using the old folder (see Dir) and the next launch tries again.

// LegacyDirName is the data dir's name before the rename.
const LegacyDirName = product.LegacyDataDirName

// Migration says what MigrateLegacy did, for the log.
type Migration struct {
	From, To string
	Moved    bool  // the old folder's contents are now in the new one
	Err      error // what went wrong; the old folder is still there
	// Leftover is set when the copy is in place but the old folder could not be removed.
	Leftover error
}

// String is the log line, or "" when there was nothing to do.
func (m Migration) String() string {
	switch {
	case m.Err != nil:
		return fmt.Sprintf("data: could not move %s to %s, kept the old folder: %v", m.From, m.To, m.Err)
	case m.Moved && m.Leftover != nil:
		return fmt.Sprintf("data: moved %s to %s, but the old folder is still there: %v", m.From, m.To, m.Leftover)
	case m.Moved:
		return fmt.Sprintf("data: moved %s to %s", m.From, m.To)
	}
	return ""
}

// MigrateLegacy moves base/<LegacyDirName> to base/<AppDirName> when the new one does
// not exist yet. base is the user config dir; tests pass a temp dir.
func MigrateLegacy(base string) Migration {
	from, to := filepath.Join(base, LegacyDirName), filepath.Join(base, AppDirName)
	m := Migration{From: from, To: to}
	if _, err := os.Lstat(to); !errors.Is(err, fs.ErrNotExist) {
		return m // already there (or unknowable): nothing to move
	}
	fi, err := os.Stat(from)
	if err != nil || !fi.IsDir() {
		return m // no old folder
	}
	tmp, err := os.MkdirTemp(base, "."+AppDirName+"-moving-")
	if err != nil {
		m.Err = err
		return m
	}
	if err := copyTree(from, tmp); err != nil {
		_ = os.RemoveAll(tmp)
		m.Err = err
		return m
	}
	if err := os.Chmod(tmp, fi.Mode().Perm()); err != nil {
		_ = os.RemoveAll(tmp)
		m.Err = err
		return m
	}
	if err := os.Rename(tmp, to); err != nil {
		_ = os.RemoveAll(tmp)
		m.Err = err
		return m
	}
	m.Moved = true
	if err := os.RemoveAll(from); err != nil {
		m.Leftover = err
	}
	return m
}

// copyTree copies the regular files and folders under src into dst, which exists.
// Symlinks and other special files are skipped: the app writes none.
func copyTree(src, dst string) error {
	return filepath.WalkDir(src, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		rel, err := filepath.Rel(src, path)
		if err != nil || rel == "." {
			return err
		}
		target := filepath.Join(dst, rel)
		switch {
		case d.IsDir():
			return os.Mkdir(target, 0o755)
		case d.Type().IsRegular():
			return copyFile(path, target)
		}
		return nil
	})
}

func copyFile(src, dst string) (err error) {
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()
	fi, err := in.Stat()
	if err != nil {
		return err
	}
	out, err := os.OpenFile(dst, os.O_WRONLY|os.O_CREATE|os.O_EXCL, fi.Mode().Perm())
	if err != nil {
		return err
	}
	defer func() {
		if cerr := out.Close(); err == nil {
			err = cerr
		}
	}()
	if _, err = io.Copy(out, in); err != nil {
		return err
	}
	return out.Sync()
}

var (
	migrateOnce sync.Once
	migration   Migration
)

// LastMigration is what Dir's migration did this run, for the app log (which opens
// after Dir has run). The zero Migration means nothing happened.
func LastMigration() Migration {
	return migration
}

// migrateOnceIn runs MigrateLegacy the first time the process asks for its data dir.
func migrateOnceIn(base string) {
	migrateOnce.Do(func() { migration = MigrateLegacy(base) })
}
