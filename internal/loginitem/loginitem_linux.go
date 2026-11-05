//go:build linux

// Package loginitem starts the app at login. On Linux that is an XDG autostart entry:
// a .desktop file in ~/.config/autostart (or $XDG_CONFIG_HOME/autostart) that every
// freedesktop session (GNOME, KDE, Xfce, Cinnamon...) runs at login. It runs the current
// executable with --hidden; for an AppImage, the AppImage file itself ($APPIMAGE), since
// the executable inside lives in a mount that changes on every run.
package loginitem

import (
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"strings"

	"flintstep/internal/product"
)

// Label names the autostart entry: <label>.desktop.
var Label = strings.ToLower(strings.ReplaceAll(product.Name, " ", "-"))

// LegacyLabel is the entry from before the rename to Flintstep. SparkX MIDI never ran on
// Linux, so there is never one; kept so the package's API is the same everywhere.
const LegacyLabel = ""

// HiddenFlag is the argument the entry starts the app with.
const HiddenFlag = "--hidden"

// autostartDir is where the entry goes; tests point it elsewhere.
var autostartDir = func() (string, error) {
	base, err := os.UserConfigDir() // $XDG_CONFIG_HOME, else ~/.config
	if err != nil {
		return "", err
	}
	return filepath.Join(base, "autostart"), nil
}

// executable is what the entry should run; tests replace it.
var executable = func() (string, error) {
	return executableFor(os.Getenv("APPIMAGE"), os.Executable)
}

// executableFor is the path to run at login: the AppImage when running from one (the
// runtime sets $APPIMAGE to its absolute path), else the binary with symlinks resolved.
func executableFor(appImage string, exe func() (string, error)) (string, error) {
	if appImage != "" && filepath.IsAbs(appImage) {
		return appImage, nil
	}
	p, err := exe()
	if err != nil {
		return "", err
	}
	return filepath.EvalSymlinks(p)
}

func entryPath() (string, error) {
	dir, err := autostartDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(dir, Label+".desktop"), nil
}

// MigrateLegacy does nothing on Linux: there is no entry from before the rename.
func MigrateLegacy() (bool, error) { return false, nil }

// Enabled reports whether the entry exists, is not switched off, and starts this
// executable.
func Enabled() bool {
	p, err := entryPath()
	if err != nil {
		return false
	}
	exe, err := executable()
	if err != nil {
		return false
	}
	have, err := os.ReadFile(p)
	if err != nil {
		return false
	}
	prog, ok := program(have)
	return ok && prog == exe
}

// Set writes the entry (on) or removes it (off). Writing again rewrites it, so an entry
// left by a copy of the app at another path now points at this one.
func Set(on bool) error {
	p, err := entryPath()
	if err != nil {
		return fmt.Errorf("loginitem: %w", err)
	}
	if !on {
		if err := os.Remove(p); err != nil && !errors.Is(err, fs.ErrNotExist) {
			return fmt.Errorf("loginitem: %w", err)
		}
		return nil
	}
	exe, err := executable()
	if err != nil {
		return fmt.Errorf("loginitem: cannot find the app: %w", err)
	}
	if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
		return fmt.Errorf("loginitem: %w", err)
	}
	tmp := p + ".tmp"
	if err := os.WriteFile(tmp, Render(exe), 0o644); err != nil {
		return fmt.Errorf("loginitem: %w", err)
	}
	if err := os.Rename(tmp, p); err != nil {
		_ = os.Remove(tmp)
		return fmt.Errorf("loginitem: %w", err)
	}
	return nil
}

// Render is the autostart entry for the executable at exe.
func Render(exe string) []byte {
	var b strings.Builder
	b.WriteString("[Desktop Entry]\n")
	b.WriteString("Type=Application\n")
	b.WriteString("Name=" + oneLine(product.Name) + "\n")
	b.WriteString("Comment=Starts " + oneLine(product.Name) + " in the tray at login\n")
	b.WriteString("Exec=" + execQuote(exe) + " " + HiddenFlag + "\n")
	b.WriteString("Icon=" + Label + "\n")
	b.WriteString("Terminal=false\n")
	b.WriteString("X-GNOME-Autostart-enabled=true\n")
	return []byte(b.String())
}

func oneLine(s string) string {
	return strings.NewReplacer("\n", " ", "\r", " ").Replace(s)
}

// execQuote quotes one Exec argument as the Desktop Entry spec wants: inside double
// quotes, `"`, backquote, `$` and `\` take a backslash; then, because Exec is a string
// value, every backslash is doubled again; and `%` (a field code) is written `%%`.
func execQuote(arg string) string {
	var q strings.Builder
	q.WriteByte('"')
	for _, r := range arg {
		switch r {
		case '"', '`', '$', '\\':
			q.WriteByte('\\')
		case '\n', '\r':
			r = ' '
		}
		q.WriteRune(r)
	}
	q.WriteByte('"')
	s := strings.ReplaceAll(q.String(), `\`, `\\`)
	return strings.ReplaceAll(s, "%", "%%")
}

// program is the first argument of the entry's Exec line (what the session runs), or
// false when the entry is switched off (Hidden=true, X-GNOME-Autostart-enabled=false) or
// has no Exec.
func program(entry []byte) (string, bool) {
	var exec string
	inMain := false
	for _, line := range strings.Split(string(entry), "\n") {
		line = strings.TrimSpace(line)
		if strings.HasPrefix(line, "[") {
			inMain = line == "[Desktop Entry]"
			continue
		}
		k, v, ok := strings.Cut(line, "=")
		if !inMain || !ok {
			continue
		}
		switch strings.TrimSpace(k) {
		case "Exec":
			exec = strings.TrimSpace(v)
		case "Hidden":
			if strings.TrimSpace(v) == "true" {
				return "", false
			}
		case "X-GNOME-Autostart-enabled":
			if strings.TrimSpace(v) == "false" {
				return "", false
			}
		}
	}
	if exec == "" {
		return "", false
	}
	return firstArg(exec)
}

// firstArg undoes execQuote for the first argument of an Exec value, quoted or not.
func firstArg(exec string) (string, bool) {
	// The string-level escapes first: \\ is one backslash (\s, \n, \t, \r are whitespace).
	var s strings.Builder
	for i := 0; i < len(exec); i++ {
		c := exec[i]
		if c == '\\' && i+1 < len(exec) {
			i++
			switch exec[i] {
			case 's':
				c = ' '
			case 'n':
				c = '\n'
			case 't':
				c = '\t'
			case 'r':
				c = '\r'
			default:
				c = exec[i]
			}
		}
		s.WriteByte(c)
	}
	v := strings.ReplaceAll(s.String(), "%%", "%")
	if !strings.HasPrefix(v, `"`) {
		arg, _, _ := strings.Cut(v, " ")
		return arg, arg != ""
	}
	var arg strings.Builder
	for i := 1; i < len(v); i++ {
		switch c := v[i]; c {
		case '\\':
			if i+1 < len(v) {
				i++
				arg.WriteByte(v[i])
			}
		case '"':
			return arg.String(), true
		default:
			arg.WriteByte(c)
		}
	}
	return "", false // unterminated quote
}
