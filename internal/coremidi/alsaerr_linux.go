//go:build linux

package coremidi

import (
	"fmt"
	"syscall"
)

// openError explains why the ALSA sequencer would not open, errno being what
// snd_seq_open returned (negated). The common causes on a desktop each get their fix.
func openError(errno int) error {
	e := syscall.Errno(errno)
	switch e {
	case syscall.ENOENT, syscall.ENODEV, syscall.ENXIO:
		return fmt.Errorf("coremidi: the ALSA sequencer is not available (no /dev/snd/seq): load it with `sudo modprobe snd-seq`: %w", e)
	case syscall.EACCES, syscall.EPERM:
		return fmt.Errorf("coremidi: not allowed to open /dev/snd/seq: add your user to the audio group (`sudo usermod -aG audio $USER`, then log in again): %w", e)
	case syscall.EBUSY, syscall.EMFILE, syscall.ENOSPC:
		return fmt.Errorf("coremidi: the ALSA sequencer has no room for another client: %w", e)
	}
	return fmt.Errorf("coremidi: cannot open the ALSA sequencer: %w", e)
}
