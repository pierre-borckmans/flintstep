// Package rotlog is an append-only log file with a size cap: when a write would take it
// past the cap, the file moves to <path>.1 (replacing the previous one) and a fresh file
// starts. So a log is never more than about twice the cap on disk, and the last session
// before a problem is still there when someone goes looking.
//
// It exists because the app's logs are on all the time now. A failure in the field has
// to arrive with its own evidence, which rules out "relaunch with a flag and try again".
package rotlog

import (
	"fmt"
	"os"
	"path/filepath"
	"sync"
)

// File is an io.Writer onto a capped log file. Safe for concurrent use.
type File struct {
	mu   sync.Mutex
	path string
	max  int64
	f    *os.File
	size int64
}

// Open opens (or creates) path for appending, capped at max bytes before rotation.
func Open(path string, max int64) (*File, error) {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return nil, err
	}
	l := &File{path: path, max: max}
	if err := l.open(); err != nil {
		return nil, err
	}
	return l, nil
}

func (l *File) open() error {
	f, err := os.OpenFile(l.path, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o644)
	if err != nil {
		return err
	}
	st, err := f.Stat()
	if err != nil {
		_ = f.Close()
		return err
	}
	l.f, l.size = f, st.Size()
	return nil
}

// Write appends p, rotating first if p would push the file past the cap. A single write
// larger than the cap still goes in whole: a log line is never split.
func (l *File) Write(p []byte) (int, error) {
	l.mu.Lock()
	defer l.mu.Unlock()
	if l.f == nil {
		return 0, fmt.Errorf("rotlog: %s is closed", l.path)
	}
	if l.size > 0 && l.size+int64(len(p)) > l.max {
		if err := l.rotate(); err != nil {
			return 0, err
		}
	}
	n, err := l.f.Write(p)
	l.size += int64(n)
	return n, err
}

func (l *File) rotate() error {
	_ = l.f.Close()
	l.f = nil
	if err := os.Rename(l.path, l.path+".1"); err != nil && !os.IsNotExist(err) {
		return err
	}
	return l.open()
}

// Close closes the file. Later writes fail.
func (l *File) Close() error {
	l.mu.Lock()
	defer l.mu.Unlock()
	if l.f == nil {
		return nil
	}
	err := l.f.Close()
	l.f = nil
	return err
}
