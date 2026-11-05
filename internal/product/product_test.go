package product

import (
	"bufio"
	"os"
	"strings"
	"testing"
)

// readEnv parses product.env the way scripts/lib/common.sh does: KEY=value per line,
// value taken verbatim, # comments and blank lines skipped.
func readEnv(t *testing.T, path string) map[string]string {
	t.Helper()
	f, err := os.Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	env := map[string]string{}
	sc := bufio.NewScanner(f)
	for sc.Scan() {
		line := sc.Text()
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		k, v, ok := strings.Cut(line, "=")
		if !ok {
			t.Fatalf("product.env: bad line %q", line)
		}
		env[k] = v
	}
	if err := sc.Err(); err != nil {
		t.Fatal(err)
	}
	return env
}

func TestMatchesProductEnv(t *testing.T) {
	env := readEnv(t, "../../product.env")
	for key, got := range map[string]string{
		"PRODUCT_NAME":       Name,
		"BUNDLE_ID":          BundleID,
		"MIDI_PORT_NAME":     MIDIPortName,
		"MIDI_LED_PORT_NAME": MIDILEDPortName,
		"DATA_DIR_NAME":      DataDirName,
		"CLI_NAME":           CLIName,
		"REPO_SLUG":          RepoSlug,
		"SITE_URL":           SiteURL,
	} {
		want, ok := env[key]
		if !ok {
			t.Errorf("product.env has no %s", key)
			continue
		}
		if got != want {
			t.Errorf("%s: product.go says %q, product.env says %q", key, got, want)
		}
	}
}

func TestCLIDirMatches(t *testing.T) {
	if _, err := os.Stat("../../cmd/" + CLIName); err != nil {
		t.Errorf("cmd/%s: %v (the Makefile's cli target builds ./cmd/$(CLI_NAME))", CLIName, err)
	}
}

func TestLegacyDiffers(t *testing.T) {
	if LegacyBundleID == BundleID || LegacyDataDirName == DataDirName {
		t.Fatal("the legacy names equal the current ones: the migrations would move a folder onto itself")
	}
}
