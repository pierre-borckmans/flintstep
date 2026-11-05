#!/usr/bin/env bash
# Write THIRD_PARTY_NOTICES.md: the licences of every third-party component in the app
# and the CLI (Go modules as linked, frontend packages as bundled). tools/notices does
# the work; see its doc comment for what counts and what makes it fail.
#
#   scripts/notices.sh            regenerate (make notices)
#   scripts/notices.sh -check     exit 1 if the committed file is stale (CI)
#
# Needs frontend/node_modules (make install) and the Go module cache (it downloads).
set -euo pipefail
# shellcheck source=lib/common.sh
. "$(dirname "$0")/lib/common.sh"

cd "$ROOT"
# go list resolves package main's embed of frontend/dist.
make -s dist
go run ./tools/notices "$@"
