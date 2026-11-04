package rotlog

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func read(t *testing.T, p string) string {
	t.Helper()
	b, err := os.ReadFile(p)
	if err != nil {
		t.Fatal(err)
	}
	return string(b)
}

func TestAppendsAcrossOpens(t *testing.T) {
	p := filepath.Join(t.TempDir(), "x.log")
	for _, s := range []string{"one\n", "two\n"} {
		l, err := Open(p, 1<<20)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := l.Write([]byte(s)); err != nil {
			t.Fatal(err)
		}
		_ = l.Close()
	}
	if got := read(t, p); got != "one\ntwo\n" {
		t.Fatalf("got %q", got)
	}
}

func TestRotatesAtTheCap(t *testing.T) {
	p := filepath.Join(t.TempDir(), "x.log")
	l, err := Open(p, 10)
	if err != nil {
		t.Fatal(err)
	}
	defer l.Close()
	for _, s := range []string{"aaaaaa\n", "bbbbbb\n", "cccccc\n"} {
		if _, err := l.Write([]byte(s)); err != nil {
			t.Fatal(err)
		}
	}
	if got := read(t, p); got != "cccccc\n" {
		t.Fatalf("current = %q", got)
	}
	if got := read(t, p+".1"); got != "bbbbbb\n" {
		t.Fatalf("rotated = %q, want only the previous file", got)
	}
}

func TestOversizedLineIsNotSplit(t *testing.T) {
	p := filepath.Join(t.TempDir(), "x.log")
	l, err := Open(p, 4)
	if err != nil {
		t.Fatal(err)
	}
	defer l.Close()
	line := strings.Repeat("z", 20) + "\n"
	if _, err := l.Write([]byte(line)); err != nil {
		t.Fatal(err)
	}
	if got := read(t, p); got != line {
		t.Fatalf("got %q", got)
	}
}

func TestWriteAfterCloseFails(t *testing.T) {
	l, err := Open(filepath.Join(t.TempDir(), "x.log"), 100)
	if err != nil {
		t.Fatal(err)
	}
	_ = l.Close()
	if _, err := l.Write([]byte("x")); err == nil {
		t.Fatal("want an error after Close")
	}
}
