//go:build linux

package coremidi

import (
	"errors"
	"strings"
	"syscall"
	"testing"
)

func TestOpenError(t *testing.T) {
	for _, c := range []struct {
		errno syscall.Errno
		want  string
	}{
		{syscall.ENOENT, "modprobe snd-seq"},
		{syscall.EACCES, "audio group"},
		{syscall.EBUSY, "no room"},
		{syscall.EIO, "cannot open the ALSA sequencer"},
	} {
		err := openError(int(c.errno))
		if !strings.Contains(err.Error(), c.want) {
			t.Errorf("%v: %q does not mention %q", c.errno, err, c.want)
		}
		if !errors.Is(err, c.errno) {
			t.Errorf("%v: not wrapped", c.errno)
		}
	}
}
