//go:build !linux

package loginitem

import (
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

func fake(t *testing.T, exe string) string {
	t.Helper()
	dir := filepath.Join(t.TempDir(), "LaunchAgents")
	oldDir, oldExe := agentsDir, executable
	agentsDir = func() (string, error) { return dir, nil }
	executable = func() (string, error) { return exe, nil }
	t.Cleanup(func() { agentsDir, executable = oldDir, oldExe })
	return filepath.Join(dir, Label+".plist")
}

func TestRender(t *testing.T) {
	got := string(Render("/Applications/Flintstep.app/Contents/MacOS/Flintstep & <co>"))
	want := `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>Label</key>
	<string>com.silversol.flintstep</string>
	<key>ProgramArguments</key>
	<array>
		<string>/Applications/Flintstep.app/Contents/MacOS/Flintstep &amp; &lt;co&gt;</string>
		<string>--hidden</string>
	</array>
	<key>RunAtLoad</key>
	<true/>
	<key>ProcessType</key>
	<string>Interactive</string>
</dict>
</plist>
`
	if got != want {
		t.Fatalf("got\n%s\nwant\n%s", got, want)
	}
	if strings.Contains(got, "KeepAlive") {
		t.Fatal("KeepAlive set")
	}
}

// TestRenderLint checks the plist with macOS's own parser when it is there.
func TestRenderLint(t *testing.T) {
	if runtime.GOOS != "darwin" {
		t.Skip("plutil is macOS-only")
	}
	p := filepath.Join(t.TempDir(), "a.plist")
	if err := os.WriteFile(p, Render("/x/y & z"), 0o644); err != nil {
		t.Fatal(err)
	}
	if out, err := exec.Command("plutil", "-lint", p).CombinedOutput(); err != nil {
		t.Fatalf("plutil: %v: %s", err, out)
	}
}

func TestProgram(t *testing.T) {
	if p, ok := program(Render("/a & b/c")); !ok || p != "/a & b/c" {
		t.Fatalf("got %q %v", p, ok)
	}
	if _, ok := program([]byte("<plist><dict><key>Label</key><string>x</string></dict></plist>")); ok {
		t.Fatal("found a program in a plist without one")
	}
	if _, ok := program([]byte("garbage")); ok {
		t.Fatal("found a program in garbage")
	}
}

func TestSet(t *testing.T) {
	p := fake(t, "/Apps/Flintstep.app/Contents/MacOS/Flintstep")
	if Enabled() {
		t.Fatal("enabled before Set")
	}
	if err := Set(false); err != nil {
		t.Fatalf("Set(false) with nothing there: %v", err)
	}
	if err := Set(true); err != nil {
		t.Fatal(err)
	}
	if !Enabled() {
		t.Fatal("not enabled after Set(true)")
	}
	b, err := os.ReadFile(p)
	if err != nil || !strings.Contains(string(b), "/Apps/Flintstep.app/Contents/MacOS/Flintstep") {
		t.Fatalf("plist %q, %v", b, err)
	}
	if err := Set(true); err != nil {
		t.Fatal("Set(true) twice:", err)
	}
	if err := Set(false); err != nil {
		t.Fatal(err)
	}
	if Enabled() {
		t.Fatal("enabled after Set(false)")
	}
	if _, err := os.Stat(p); !os.IsNotExist(err) {
		t.Fatalf("plist still there: %v", err)
	}
}

func TestEnabledOtherExecutable(t *testing.T) {
	fake(t, "/old/place/Flintstep")
	if err := Set(true); err != nil {
		t.Fatal(err)
	}
	executable = func() (string, error) { return "/new/place/Flintstep", nil }
	if Enabled() {
		t.Fatal("an agent for another copy of the app counts as enabled")
	}
	if err := Set(true); err != nil {
		t.Fatal(err)
	}
	if !Enabled() {
		t.Fatal("Set(true) did not repoint the agent")
	}
}

// oldAgent writes an agent under the old label, as the app shipped it, next to p.
func oldAgent(t *testing.T, p string) string {
	t.Helper()
	old := filepath.Join(filepath.Dir(p), LegacyLabel+".plist")
	plist := strings.Replace(string(Render("/Applications/SparkX MIDI.app/Contents/MacOS/SparkX MIDI")), Label, LegacyLabel, 1)
	if err := os.MkdirAll(filepath.Dir(old), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(old, []byte(plist), 0o644); err != nil {
		t.Fatal(err)
	}
	return old
}

func TestMigrateLegacy(t *testing.T) {
	p := fake(t, "/Applications/Flintstep.app/Contents/MacOS/Flintstep")
	old := oldAgent(t, p)
	found, err := MigrateLegacy()
	if !found || err != nil {
		t.Fatalf("MigrateLegacy() = %v, %v", found, err)
	}
	if !Enabled() {
		t.Fatal("not enabled under the new label")
	}
	b, err := os.ReadFile(p)
	if err != nil || !strings.Contains(string(b), "<string>"+Label+"</string>") {
		t.Fatalf("new agent %q, %v", b, err)
	}
	if _, err := os.Stat(old); !os.IsNotExist(err) {
		t.Fatalf("old agent still there: %v", err)
	}
	if found, err := MigrateLegacy(); found || err != nil {
		t.Fatalf("second run = %v, %v", found, err)
	}
}

func TestMigrateLegacyNothingThere(t *testing.T) {
	p := fake(t, "/Applications/Flintstep.app/Contents/MacOS/Flintstep")
	if found, err := MigrateLegacy(); found || err != nil {
		t.Fatalf("MigrateLegacy() = %v, %v", found, err)
	}
	if _, err := os.Stat(p); !os.IsNotExist(err) {
		t.Fatal("an agent appeared from nothing")
	}
}

func TestMigrateLegacyKeepsOldOnError(t *testing.T) {
	p := fake(t, "/Applications/Flintstep.app/Contents/MacOS/Flintstep")
	old := oldAgent(t, p)
	executable = func() (string, error) { return "", os.ErrNotExist }
	if found, err := MigrateLegacy(); !found || err == nil {
		t.Fatalf("MigrateLegacy() = %v, %v; want an error", found, err)
	}
	if _, err := os.Stat(old); err != nil {
		t.Fatal("old agent removed although the new one was not written:", err)
	}
	if _, err := os.Stat(p); !os.IsNotExist(err) {
		t.Fatal("half a new agent:", err)
	}
}
