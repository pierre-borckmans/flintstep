package main

import _ "embed"

// thirdPartyNotices is THIRD_PARTY_NOTICES.md (scripts/notices.sh writes it). The build
// also copies it into the bundle's Resources; embedding it means the Acknowledgements
// view works in `wails dev` too.
//
//go:embed THIRD_PARTY_NOTICES.md
var thirdPartyNotices string

// ThirdPartyNotices is the licences of the third-party code in the app, as Markdown, for
// the Acknowledgements view in Settings.
func (a *App) ThirdPartyNotices() string { return thirdPartyNotices }
