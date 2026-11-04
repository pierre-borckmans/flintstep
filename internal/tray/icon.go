package tray

import _ "embed"

// Icon is the menu bar template icon: 36x36 px black on transparent, drawn at 18 pt.
// Rendered from icon.svg by render_icon.swift; icon.png is the 18 px version.
//
//go:generate swift render_icon.swift
//go:embed icon@2x.png
var Icon []byte
