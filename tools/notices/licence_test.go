package main

import (
	"os"
	"path/filepath"
	"slices"
	"testing"
)

func TestClassify(t *testing.T) {
	cases := []struct {
		text string
		want []string
	}{
		{"Permission is hereby granted, free of charge, to any person", []string{"MIT"}},
		{"Permission to use, copy, modify, and/or distribute this software for any\npurpose with or without fee is hereby granted, provided that the above\ncopyright notice and this permission notice appear in all copies.", []string{"ISC"}},
		{"Permission to use, copy, modify, and/or distribute this software for any purpose with or without fee is hereby granted.", []string{"0BSD"}},
		{"Redistribution and use in source and binary forms ... Neither the name of Google", []string{"BSD-3-Clause"}},
		{"Redistribution and use in source and binary forms, with or without modification", []string{"BSD-2-Clause"}},
		{"Apache License\n                           Version 2.0, January 2004", []string{"Apache-2.0"}},
		{"GNU GENERAL PUBLIC LICENSE Version 3", []string{"GPL"}},
		{"GNU AFFERO GENERAL PUBLIC LICENSE ... GNU General Public License", []string{"AGPL"}},
		{"GNU LESSER GENERAL PUBLIC LICENSE", []string{"LGPL"}},
		// The MPL mentions the GPL family as secondary licences.
		{"Mozilla Public License Version 2.0 ... GNU Affero General Public License", []string{"MPL-2.0"}},
		// lucide-react: ISC, then MIT for the icons that came from Feather.
		{"ISC License\nPermission to use, copy, modify, and/or distribute this software for any purpose with or without fee is hereby granted, provided that the above copyright notice and this permission notice appear in all copies.\n---\nThe MIT License\nPermission is hereby granted, free of charge,", []string{"ISC", "MIT"}},
		{"All rights reserved. Do not copy.", nil},
	}
	for _, c := range cases {
		if got := classify(c.text); !slices.Equal(got, c.want) {
			t.Errorf("classify(%.40q) = %v, want %v", c.text, got, c.want)
		}
	}
}

func TestLicenceIn(t *testing.T) {
	a, b := t.TempDir(), t.TempDir()
	write := func(dir, name, text string) {
		if err := os.WriteFile(filepath.Join(dir, name), []byte(text), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	write(a, "LICENSE.md", "MIT License  \r\n\r\nPermission is hereby granted, free of charge, to any person\r\n\n# Licenses of bundled dependencies\nGNU General Public License")
	write(a, "README.md", "not a licence")
	write(b, "license.md", "ignored: a's LICENSE.md wins")
	write(b, "PATENTS", "patent grant")

	ids, text := licenceIn("\n# Licenses of bundled dependencies", a, b)
	if !slices.Equal(ids, []string{"MIT"}) {
		t.Errorf("ids = %v", ids)
	}
	want := "MIT License\n\nPermission is hereby granted, free of charge, to any person\n\npatent grant"
	if text != want {
		t.Errorf("text = %q, want %q", text, want)
	}

	// A NOTICE or PATENTS file alone is not a licence.
	only := t.TempDir()
	write(only, "NOTICE", "notice")
	if _, text := licenceIn("", only); text != "" {
		t.Errorf("NOTICE alone, text = %q", text)
	}
	if _, text := licenceIn("", t.TempDir()); text != "" {
		t.Errorf("no licence file, text = %q", text)
	}
}
