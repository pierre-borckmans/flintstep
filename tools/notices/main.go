// Command notices writes THIRD_PARTY_NOTICES.md: the copyright and licence text of every
// third-party component the shipped binaries contain. Run it through scripts/notices.sh
// (make notices) from the repo root.
//
// Go side: the non-std modules of the packages linked into the app (with Wails' desktop
// and production tags) and into the CLI, for every target in goTargets, plus Go's own
// standard library and runtime. Frontend side: the runtime dependencies in
// frontend/package.json and what they pull in, read from frontend/node_modules, plus the
// few dev packages whose own code the build injects into the bundle (bundledDev).
//
// It fails, listing every problem, when a component has no licence file, or a licence
// that is not in allowed (GPL, AGPL, LGPL, MPL, anything it can't recognise), or an npm
// package.json that disagrees with its licence file.
//
//	notices [-check]    -check compares instead of writing; exit 1 when stale
package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"maps"
	"os"
	"os/exec"
	"path/filepath"
	"slices"
	"sort"
	"strings"
)

const outFile = "THIRD_PARTY_NOTICES.md"

// goTargets are the builds whose linked packages count. The Linux targets cover the Linux
// port; another platform goes here.
var goTargets = []struct{ goos, goarch string }{
	{"darwin", "arm64"},
	{"darwin", "amd64"},
	{"linux", "amd64"},
	{"linux", "arm64"},
}

// appTags are the tags `wails build` compiles the app with.
const appTags = "desktop,production"

// bundledDev are dev dependencies whose own code ends up in the frontend bundle: Vite
// injects its modulepreload polyfill and dynamic-import preload helper. Their own
// dependencies are build tools and are not followed.
var bundledDev = []string{"vite"}

// allowed are the licences the notices may contain: permissive, satisfied by shipping
// this file.
var allowed = map[string]bool{
	"MIT": true, "ISC": true, "0BSD": true, "Zlib": true,
	"BSD-2-Clause": true, "BSD-3-Clause": true, "Apache-2.0": true,
}

type component struct {
	name, version, url, kind string   // kind: "Go" or "npm"
	licences                 []string // in the order the licence file has them
	text                     string   // licence file(s), then NOTICE/PATENTS
}

func (c component) licence() string { return strings.Join(c.licences, " AND ") }

func main() {
	check := flag.Bool("check", false, "compare with "+outFile+" instead of writing it; exit 1 if stale")
	flag.Parse()

	var problems []string
	fail := func(format string, a ...any) { problems = append(problems, fmt.Sprintf(format, a...)) }

	product, err := readProduct("product.env")
	if err != nil {
		fatal(err)
	}
	comps, err := goComponents("./cmd/"+product["CLI_NAME"], fail)
	if err != nil {
		fatal(err)
	}
	web, err := npmComponents("frontend", fail)
	if err != nil {
		fatal(err)
	}
	comps = append(comps, web...)
	for _, c := range comps {
		if c.text == "" {
			continue // reported already
		}
		if len(c.licences) == 0 {
			fail("%s %s (%s): licence not recognised", c.name, c.version, c.kind)
		}
		for _, l := range c.licences {
			if !allowed[l] {
				fail("%s %s (%s): %s is not an allowed licence", c.name, c.version, c.kind, l)
			}
		}
	}
	if len(problems) > 0 {
		sort.Strings(problems)
		fmt.Fprintln(os.Stderr, "notices: refusing to write "+outFile+":")
		for _, p := range problems {
			fmt.Fprintln(os.Stderr, "  "+p)
		}
		os.Exit(1)
	}

	out := render(product["PRODUCT_NAME"], comps)
	if *check {
		cur, err := os.ReadFile(outFile)
		if err != nil || !bytes.Equal(cur, out) {
			fatal(errors.New(outFile + " does not match the dependencies; run 'make notices' and commit it"))
		}
		fmt.Println(outFile + " is up to date")
		return
	}
	if err := os.WriteFile(outFile, out, 0o644); err != nil {
		fatal(err)
	}
	fmt.Printf("wrote %s (%d components)\n", outFile, len(comps))
}

func fatal(err error) {
	fmt.Fprintln(os.Stderr, "notices:", err)
	os.Exit(1)
}

func readProduct(path string) (map[string]string, error) {
	b, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	m := map[string]string{}
	for _, line := range strings.Split(string(b), "\n") {
		if k, v, ok := strings.Cut(line, "="); ok && !strings.HasPrefix(line, "#") {
			m[strings.TrimSpace(k)] = strings.TrimSpace(v)
		}
	}
	for _, k := range []string{"PRODUCT_NAME", "CLI_NAME"} {
		if m[k] == "" {
			return nil, fmt.Errorf("%s: no %s", path, k)
		}
	}
	return m, nil
}

// ---- Go ----

func goCmd(env []string, args ...string) ([]byte, error) {
	cmd := exec.Command("go", args...)
	cmd.Env = append(os.Environ(), env...)
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	out, err := cmd.Output()
	if err != nil {
		return nil, fmt.Errorf("go %s: %w\n%s", strings.Join(args, " "), err, stderr.String())
	}
	return out, nil
}

func goComponents(cli string, fail func(string, ...any)) ([]component, error) {
	const format = `{{if not .Standard}}{{with .Module}}{{if not .Main}}{{.Path}}{{end}}{{end}}{{end}}`
	mods := map[string]bool{}
	for _, t := range goTargets {
		env := []string{"GOOS=" + t.goos, "GOARCH=" + t.goarch, "CGO_ENABLED=1"}
		for _, run := range [][]string{
			{"list", "-deps", "-tags", appTags, "-f", format, "."},
			{"list", "-deps", "-f", format, cli},
		} {
			out, err := goCmd(env, run...)
			if err != nil {
				return nil, err
			}
			for _, m := range strings.Fields(string(out)) {
				mods[m] = true
			}
		}
	}

	out, err := goCmd(nil, append([]string{"list", "-m", "-json"}, slices.Sorted(maps.Keys(mods))...)...)
	if err != nil {
		return nil, err
	}
	type module struct {
		Path, Version, Dir string
		Replace            *module
	}
	var comps []component
	dec := json.NewDecoder(bytes.NewReader(out))
	for dec.More() {
		var m module
		if err := dec.Decode(&m); err != nil {
			return nil, err
		}
		src := m
		if m.Replace != nil {
			src = *m.Replace
		}
		if src.Dir == "" {
			b, err := goCmd(nil, "mod", "download", "-json", src.Path+"@"+src.Version)
			if err != nil {
				return nil, err
			}
			if err := json.Unmarshal(b, &src); err != nil {
				return nil, err
			}
		}
		c := component{name: m.Path, version: m.Version, url: moduleURL(m.Path), kind: "Go"}
		c.licences, c.text = licenceIn("", src.Dir)
		if c.text == "" {
			fail("%s %s (Go): no LICENSE or COPYING file in %s", m.Path, m.Version, src.Dir)
		}
		comps = append(comps, c)
	}

	// Go's runtime and standard library are in every binary. Homebrew keeps Go's LICENSE
	// one level above GOROOT.
	b, err := goCmd(nil, "env", "GOROOT")
	if err != nil {
		return nil, err
	}
	root := strings.TrimSpace(string(b))
	std := component{name: "Go standard library and runtime", url: "https://go.dev", kind: "Go"}
	std.licences, std.text = licenceIn("", root, filepath.Dir(root))
	if std.text == "" {
		fail("no LICENSE in GOROOT (%s)", root)
	}
	return append(comps, std), nil
}

func moduleURL(path string) string {
	parts := strings.Split(path, "/")
	if (parts[0] == "github.com" || parts[0] == "git.sr.ht") && len(parts) >= 3 {
		return "https://" + strings.Join(parts[:3], "/")
	}
	return "https://pkg.go.dev/" + path
}

// ---- npm ----

type pkgJSON struct {
	Name                 string            `json:"name"`
	Version              string            `json:"version"`
	License              any               `json:"license"`
	Homepage             string            `json:"homepage"`
	Repository           any               `json:"repository"`
	Dependencies         map[string]string `json:"dependencies"`
	OptionalDependencies map[string]string `json:"optionalDependencies"`
}

func readPkg(dir string) (pkgJSON, error) {
	var p pkgJSON
	b, err := os.ReadFile(filepath.Join(dir, "package.json"))
	if err != nil {
		return p, err
	}
	return p, json.Unmarshal(b, &p)
}

func npmComponents(root string, fail func(string, ...any)) ([]component, error) {
	top, err := readPkg(root)
	if err != nil {
		return nil, err
	}
	if _, err := os.Stat(filepath.Join(root, "node_modules")); err != nil {
		return nil, fmt.Errorf("no %s/node_modules: run 'make install' first", root)
	}
	type item struct {
		name, from string
		optional   bool // a missing optional dependency is fine
		follow     bool // walk its dependencies
	}
	var queue []item
	for _, n := range slices.Sorted(maps.Keys(top.Dependencies)) {
		queue = append(queue, item{n, root, false, true})
	}
	for _, n := range bundledDev {
		queue = append(queue, item{n, root, false, false})
	}
	seen := map[string]bool{}
	var comps []component
	for len(queue) > 0 {
		it := queue[0]
		queue = queue[1:]
		// Node's resolution: the nearest node_modules up from the dependent.
		dir := ""
		for d := it.from; ; d = filepath.Dir(d) {
			cand := filepath.Join(d, "node_modules", it.name)
			if _, err := os.Stat(filepath.Join(cand, "package.json")); err == nil {
				dir = cand
				break
			}
			if d == root || !strings.HasPrefix(d, root) {
				break
			}
		}
		if dir == "" {
			if !it.optional {
				fail("%s (npm): not installed; run 'make install'", it.name)
			}
			continue
		}
		if seen[dir] {
			continue
		}
		seen[dir] = true
		p, err := readPkg(dir)
		if err != nil {
			return nil, err
		}
		c := component{name: p.Name, version: p.Version, url: npmURL(p), kind: "npm"}
		// Vite's LICENSE.md goes on to the licences of what Vite itself bundles; only Vite's
		// own helpers reach our bundle, so only its own licence applies.
		c.licences, c.text = licenceIn("\n# Licenses of bundled dependencies", dir)
		declared := spdx(p.License)
		switch {
		case c.text == "":
			fail("%s %s (npm): no LICENSE file in %s", p.Name, p.Version, dir)
		case len(c.licences) == 0 || declared != c.licences[0]:
			fail("%s %s (npm): package.json says %q, the licence file reads as %q", p.Name, p.Version, declared, c.licence())
		}
		comps = append(comps, c)
		if !it.follow {
			continue
		}
		for _, n := range slices.Sorted(maps.Keys(p.Dependencies)) {
			queue = append(queue, item{n, dir, false, true})
		}
		for _, n := range slices.Sorted(maps.Keys(p.OptionalDependencies)) {
			queue = append(queue, item{n, dir, true, true})
		}
	}
	return comps, nil
}

func spdx(v any) string {
	switch l := v.(type) {
	case string:
		return strings.Trim(l, "()")
	case map[string]any:
		s, _ := l["type"].(string)
		return s
	}
	return ""
}

func npmURL(p pkgJSON) string {
	repo := ""
	switch r := p.Repository.(type) {
	case string:
		repo = r
	case map[string]any:
		repo, _ = r["url"].(string)
	}
	repo = strings.TrimSuffix(strings.TrimPrefix(repo, "git+"), ".git")
	switch {
	case strings.HasPrefix(repo, "https://"):
		return repo
	case strings.HasPrefix(p.Homepage, "https://"):
		return p.Homepage
	}
	return "https://www.npmjs.com/package/" + p.Name
}

// ---- output ----

func render(product string, comps []component) []byte {
	// licence -> text -> components
	groups := map[string]map[string][]component{}
	for _, c := range comps {
		l := c.licence()
		if groups[l] == nil {
			groups[l] = map[string][]component{}
		}
		groups[l][c.text] = append(groups[l][c.text], c)
	}
	key := func(c component) string { return strings.ToLower(c.name) + "\x00" + c.kind }

	var b strings.Builder
	b.WriteString("# Third-party notices\n\n")
	fmt.Fprintf(&b, "%s is MIT licensed (see LICENSE). The app and its command-line bridge include the open-source components below. They are grouped by licence, and each distinct licence text appears once, after the components it covers.\n\n", product)
	b.WriteString("Generated by `scripts/notices.sh` from the Go packages linked into the macOS and Linux builds and the frontend packages bundled into the app. Do not edit by hand.\n")
	for _, lic := range slices.Sorted(maps.Keys(groups)) {
		fmt.Fprintf(&b, "\n## %s\n", lic)
		type block struct {
			text  string
			comps []component
		}
		var blocks []block
		for text, cs := range groups[lic] {
			sort.Slice(cs, func(i, j int) bool { return key(cs[i]) < key(cs[j]) })
			blocks = append(blocks, block{text, cs})
		}
		sort.Slice(blocks, func(i, j int) bool { return key(blocks[i].comps[0]) < key(blocks[j].comps[0]) })
		for _, bl := range blocks {
			b.WriteString("\n")
			for _, c := range bl.comps {
				v := ""
				if c.version != "" {
					v = " " + c.version
				}
				fmt.Fprintf(&b, "- [%s](%s)%s (%s)\n", c.name, c.url, v, c.kind)
			}
			fence := "```"
			for strings.Contains(bl.text, fence) {
				fence += "`"
			}
			fmt.Fprintf(&b, "\n%stext\n%s\n%s\n", fence, bl.text, fence)
		}
	}
	return []byte(b.String())
}
