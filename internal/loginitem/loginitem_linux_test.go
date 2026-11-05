//go:build linux

package loginitem

import (
	"errors"
	"os"
	"path/filepath"
	"testing"
)

func fake(t *testing.T, exe string) string {
	t.Helper()
	dir := filepath.Join(t.TempDir(), "autostart")
	oldDir, oldExe := autostartDir, executable
	autostartDir = func() (string, error) { return dir, nil }
	executable = func() (string, error) { return exe, nil }
	t.Cleanup(func() { autostartDir, executable = oldDir, oldExe })
	return filepath.Join(dir, Label+".desktop")
}

func TestRender(t *testing.T) {
	got := string(Render("/opt/Flintstep/flintstep"))
	want := `[Desktop Entry]
Type=Application
Name=Flintstep
Comment=Starts Flintstep in the tray at login
Exec="/opt/Flintstep/flintstep" --hidden
Icon=flintstep
Terminal=false
X-GNOME-Autostart-enabled=true
`
	if got != want {
		t.Fatalf("got\n%s\nwant\n%s", got, want)
	}
	if Label != "flintstep" {
		t.Fatalf("label %q", Label)
	}
}

// Every path, however odd, comes back out of the Exec line it was written into.
func TestExecRoundTrip(t *testing.T) {
	for _, p := range []string{
		"/usr/bin/flintstep",
		"/home/jo/Apps/Flintstep 1.0.AppImage",
		`/home/jo/we"ird/$HOME/back\slash/100%/tick` + "`",
		"/home/jo/Téléchargements/Flintstep.AppImage",
	} {
		got, ok := program(Render(p))
		if !ok || got != p {
			t.Errorf("%q: read back %q (%v)", p, got, ok)
		}
	}
}

func TestProgram(t *testing.T) {
	for _, c := range []struct {
		name, entry, want string
		ok                bool
	}{
		{"unquoted", "[Desktop Entry]\nExec=/usr/bin/flintstep --hidden\n", "/usr/bin/flintstep", true},
		{"hidden", "[Desktop Entry]\nExec=/usr/bin/flintstep\nHidden=true\n", "", false},
		{"gnome off", "[Desktop Entry]\nExec=/usr/bin/flintstep\nX-GNOME-Autostart-enabled=false\n", "", false},
		{"no exec", "[Desktop Entry]\nName=x\n", "", false},
		{"other group", "[Desktop Action new]\nExec=/bin/other\n[Desktop Entry]\nExec=/usr/bin/flintstep\n", "/usr/bin/flintstep", true},
		{"unterminated", "[Desktop Entry]\nExec=\"/usr/bin/flint\n", "", false},
		{"escaped space", "[Desktop Entry]\nExec=/opt/a\\sb\n", "/opt/a", true},
	} {
		got, ok := program([]byte(c.entry))
		if got != c.want || ok != c.ok {
			t.Errorf("%s: got %q %v, want %q %v", c.name, got, ok, c.want, c.ok)
		}
	}
}

func TestSetAndEnabled(t *testing.T) {
	p := fake(t, "/opt/Flintstep/flintstep")
	if Enabled() {
		t.Fatal("enabled before Set")
	}
	if err := Set(true); err != nil {
		t.Fatal(err)
	}
	if !Enabled() {
		t.Fatal("not enabled after Set(true)")
	}
	if b, _ := os.ReadFile(p); string(b) != string(Render("/opt/Flintstep/flintstep")) {
		t.Fatalf("entry is\n%s", b)
	}
	// Another copy of the app does not count as enabled, and Set(true) takes over.
	executable = func() (string, error) { return "/home/jo/Flintstep.AppImage", nil }
	if Enabled() {
		t.Fatal("enabled for another executable")
	}
	if err := Set(true); err != nil || !Enabled() {
		t.Fatalf("take over: %v", err)
	}
	if err := Set(false); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(p); !errors.Is(err, os.ErrNotExist) {
		t.Fatal("entry still there after Set(false)")
	}
	if err := Set(false); err != nil {
		t.Fatalf("Set(false) twice: %v", err)
	}
	if found, err := MigrateLegacy(); found || err != nil {
		t.Fatalf("MigrateLegacy: %v %v", found, err)
	}
}

func TestExecutableFor(t *testing.T) {
	exe := func() (string, error) { return "/tmp/.mount_FlintsXYZ/usr/bin/flintstep", nil }
	if got, _ := executableFor("/home/jo/Flintstep.AppImage", exe); got != "/home/jo/Flintstep.AppImage" {
		t.Fatalf("AppImage: %q", got)
	}
	// A relative $APPIMAGE is not trusted.
	if got, _ := executableFor("Flintstep.AppImage", func() (string, error) { return "/", nil }); got != "/" {
		t.Fatalf("relative APPIMAGE: %q", got)
	}
}
