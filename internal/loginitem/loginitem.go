// Package loginitem starts the app at login with a per-user LaunchAgent, which needs
// no entitlement and no helper app: a plist in ~/Library/LaunchAgents that launchd
// reads at the next login. It runs the current executable with --hidden.
package loginitem

import (
	"bytes"
	"encoding/xml"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
)

// Label is the LaunchAgent's label and the plist's file name.
const Label = "com.silversol.sparkxmidi"

// HiddenFlag is the argument the agent starts the app with.
const HiddenFlag = "--hidden"

// agentsDir is where the plist goes; tests point it elsewhere.
var agentsDir = func() (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(home, "Library", "LaunchAgents"), nil
}

// executable is the running binary with symlinks resolved; tests replace it.
var executable = func() (string, error) {
	p, err := os.Executable()
	if err != nil {
		return "", err
	}
	return filepath.EvalSymlinks(p)
}

func plistPath() (string, error) {
	dir, err := agentsDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(dir, Label+".plist"), nil
}

// Enabled reports whether the agent exists and starts this executable.
func Enabled() bool {
	p, err := plistPath()
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

// program is the first ProgramArguments entry of a plist: what launchd runs.
func program(plist []byte) (string, bool) {
	d := xml.NewDecoder(bytes.NewReader(plist))
	d.Strict = false
	var lastKey string
	inArgs := false
	for {
		tok, err := d.Token()
		if err != nil {
			return "", false
		}
		se, ok := tok.(xml.StartElement)
		if !ok {
			continue
		}
		switch se.Name.Local {
		case "key":
			var k string
			if d.DecodeElement(&k, &se) != nil {
				return "", false
			}
			lastKey = k
		case "array":
			inArgs = lastKey == "ProgramArguments"
		case "string":
			var v string
			if d.DecodeElement(&v, &se) != nil {
				return "", false
			}
			if inArgs {
				return v, true
			}
		}
	}
}

// Set installs the agent (on) or removes it (off). Installing again rewrites it, so
// an agent left by a copy of the app at another path now points at this one.
func Set(on bool) error {
	p, err := plistPath()
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

// Render is the agent's plist for the executable at exe.
func Render(exe string) []byte {
	var b bytes.Buffer
	b.WriteString(xml.Header)
	b.WriteString(`<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">` + "\n")
	b.WriteString(`<plist version="1.0">` + "\n<dict>\n")
	b.WriteString("\t<key>Label</key>\n\t<string>" + esc(Label) + "</string>\n")
	b.WriteString("\t<key>ProgramArguments</key>\n\t<array>\n")
	b.WriteString("\t\t<string>" + esc(exe) + "</string>\n")
	b.WriteString("\t\t<string>" + esc(HiddenFlag) + "</string>\n")
	b.WriteString("\t</array>\n")
	b.WriteString("\t<key>RunAtLoad</key>\n\t<true/>\n")
	b.WriteString("\t<key>ProcessType</key>\n\t<string>Interactive</string>\n")
	b.WriteString("</dict>\n</plist>\n")
	return b.Bytes()
}

func esc(s string) string {
	var b bytes.Buffer
	_ = xml.EscapeText(&b, []byte(s))
	return b.String()
}
