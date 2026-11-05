package main

import (
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
)

var (
	licenceName = regexp.MustCompile(`(?i)^(licen[cs]e|copying|unlicense)([.-][a-z0-9.-]+)?$`)
	noticeName  = regexp.MustCompile(`(?i)^(notice|patents)(\.(md|txt))?$`)
)

// licenceIn reads the licence files in dirs (a name found in an earlier dir wins), then
// their NOTICE and PATENTS files. ids are the licences the licence files hold, in the
// order they appear; text is everything, ready to print. No licence file: text is "".
// cut, when found in a licence file, ends it there.
func licenceIn(cut string, dirs ...string) (ids []string, text string) {
	seen := map[string]bool{}
	var lic, notes []string
	for _, dir := range dirs {
		entries, err := os.ReadDir(dir)
		if err != nil {
			continue
		}
		for _, e := range entries {
			name := e.Name()
			isLic, isNote := licenceName.MatchString(name), noticeName.MatchString(name)
			if e.IsDir() || (!isLic && !isNote) || seen[strings.ToLower(name)] {
				continue
			}
			b, err := os.ReadFile(filepath.Join(dir, name))
			if err != nil {
				continue
			}
			seen[strings.ToLower(name)] = true
			t := normalise(string(b))
			if !isLic {
				notes = append(notes, t)
				continue
			}
			if i := strings.Index(t, cut); cut != "" && i >= 0 {
				t = strings.TrimRight(t[:i], "\n")
			}
			lic = append(lic, t)
			for _, id := range classify(t) {
				if !contains(ids, id) {
					ids = append(ids, id)
				}
			}
		}
	}
	if len(lic) == 0 {
		return nil, ""
	}
	return ids, strings.Join(append(lic, notes...), "\n\n")
}

func contains(s []string, v string) bool {
	for _, x := range s {
		if x == v {
			return true
		}
	}
	return false
}

// normalise gives a text LF line ends, no trailing spaces and no blank lines around it.
func normalise(s string) string {
	s = strings.ReplaceAll(s, "\r\n", "\n")
	lines := strings.Split(s, "\n")
	for i, l := range lines {
		lines[i] = strings.TrimRight(l, " \t")
	}
	return strings.Trim(strings.Join(lines, "\n"), "\n")
}

// classify lists the licences a text holds, by SPDX id, in the order they appear: one for
// most files, more for a file like lucide's (ISC, then MIT for the icons from Feather).
// The copyleft ones come out as MPL-2.0, LGPL, AGPL or GPL. Nil: not recognised.
func classify(text string) []string {
	t := strings.Join(strings.Fields(strings.ToLower(text)), " ")
	// The MPL names the GPL family as "secondary licenses"; that isn't a second licence.
	if strings.Contains(t, "mozilla public license") {
		return []string{"MPL-2.0"}
	}
	at := func(phrases ...string) int {
		best := -1
		for _, p := range phrases {
			if i := strings.Index(t, p); i >= 0 && (best < 0 || i < best) {
				best = i
			}
		}
		return best
	}
	type hit struct {
		id string
		at int
	}
	var hits []hit
	add := func(id string, i int) {
		if i >= 0 {
			hits = append(hits, hit{id, i})
		}
	}
	agpl := at("gnu affero general public license")
	lgpl := at("gnu lesser general public license", "gnu library general public license")
	add("AGPL", agpl)
	add("LGPL", lgpl)
	if agpl < 0 && lgpl < 0 {
		add("GPL", at("gnu general public license"))
	}
	add("Apache-2.0", at("apache license version 2.0", "apache license, version 2.0"))
	add("MIT", at("permission is hereby granted, free of charge"))
	if i := at("permission to use, copy, modify, and/or distribute this software for any purpose",
		"permission to use, copy, modify, and distribute this software for any purpose"); i >= 0 {
		if strings.Contains(t, "provided that the above copyright notice and this permission notice appear in all copies") {
			add("ISC", i)
		} else {
			add("0BSD", i)
		}
	}
	if i := at("redistribution and use in source and binary forms"); i >= 0 {
		if at("neither the name", "names of its contributors may be used") >= 0 {
			add("BSD-3-Clause", i)
		} else {
			add("BSD-2-Clause", i)
		}
	}
	add("Zlib", at("altered source versions must be plainly marked"))
	sort.SliceStable(hits, func(i, j int) bool { return hits[i].at < hits[j].at })
	var ids []string
	for _, h := range hits {
		ids = append(ids, h.id)
	}
	return ids
}
