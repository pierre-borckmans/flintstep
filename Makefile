# Dev tasks. Tooling: Go + golangci-lint, bun + Biome, Wails v2.
# `make check` is what CI runs; run it before you push.

# Names come from product.env (PRODUCT_NAME, BUNDLE_ID, CLI_NAME, ...).
include product.env
empty :=
space := $(empty) $(empty)

FRONTEND := frontend
BUN      := cd $(FRONTEND) && bun
GOLANGCI := golangci-lint
WAILS    := wails

# Version from git: v0.2.0 on a tag, v0.2.0-3-gabc1234 after one, a bare hash before the
# first tag, -dirty with uncommitted changes. Override with `make dmg VERSION=...`.
VERSION  ?= $(shell git describe --tags --always --dirty 2>/dev/null || echo dev)
# darwin/universal (arm64 + amd64), or darwin/arm64 for a faster local build.
PLATFORM ?= darwin/universal
APP      := build/bin/$(PRODUCT_NAME).app
DMG      := build/bin/$(subst $(space),-,$(PRODUCT_NAME))-$(VERSION).dmg

.DEFAULT_GOAL := help
.PHONY: help install dist icon dev app cert dmg release product product-check cli frontend fmt fmt-go fmt-web lint lint-go lint-web \
        test test-go test-web build check hooks precommit clean

help: ## List targets
	@grep -hE '^[a-z-]+:.*?## ' $(MAKEFILE_LIST) | sort | awk 'BEGIN{FS=":.*?## "}{printf "  \033[36m%-10s\033[0m %s\n",$$1,$$2}'

install: ## Install frontend deps
	$(BUN) install

# package main embeds all:frontend/dist, so Go tooling needs the directory to exist with
# at least one file in it. A stub keeps `make lint`/`make test` fast; `make app` builds
# the real thing.
dist:
	@test -n "$$(ls -A $(FRONTEND)/dist 2>/dev/null)" || { \
	  mkdir -p $(FRONTEND)/dist && \
	  echo '<!doctype html><title>stub</title>' > $(FRONTEND)/dist/index.html && \
	  echo "note: wrote a stub $(FRONTEND)/dist for the Go embed; run 'make frontend' for the real build"; }

icon: ## Build the app icon (ICON=<.svg|.png>, default build/icon/appicon.svg)
	scripts/icon/build-icon.sh $(ICON)

dev: product-check ## Run the app with live reload
	$(WAILS) dev

app: ## Build and sign build/bin/<PRODUCT_NAME>.app (VERSION from git)
	scripts/release/build.sh "$(VERSION)" "$(PLATFORM)"
	@# Best identity available: Developer ID, else the local certificate (make cert),
	@# which keeps the Bluetooth permission across rebuilds, else ad hoc.
	scripts/release/sign.sh "$(APP)"

cert: ## Create the local signing certificate (once per Mac; NEW=1 replaces a pre-rename one)
	scripts/signing/local-cert.sh $(if $(NEW),--new)

dmg: app ## Pack the .app into build/bin/<name>-<version>.dmg (no notarization)
	scripts/release/dmg.sh "$(DMG)" "$(APP)"

release: ## Build, sign, DMG, notarize if credentials exist, checksums (VERSION=vX.Y.Z)
	PLATFORM="$(PLATFORM)" scripts/release/release.sh "$(VERSION)"

product: ## Copy product.env into wails.json and build/darwin/Info*.plist
	scripts/product/sync.sh

product-check:
	@scripts/product/sync.sh --check

cli: dist ## Build the headless bridge into build/bin/<CLI_NAME>
	go build -o "build/bin/$(CLI_NAME)" ./cmd/$(CLI_NAME)

.PHONY: notices
notices: ## Regenerate THIRD_PARTY_NOTICES.md (needs make install)
	scripts/notices.sh

frontend: ## Build the real frontend bundle (tsc + vite)
	$(BUN) run build

fmt: fmt-go fmt-web ## Format everything

fmt-go:
	gofmt -w .

fmt-web:
	$(BUN) run format

lint: lint-go lint-web ## Lint everything

lint-go: dist
	$(GOLANGCI) run ./...

lint-web:
	$(BUN) run lint

test: test-go test-web ## Run all tests

test-go: dist
	go test ./... -race

test-web:
	$(BUN) run test

build: frontend ## Compile everything (no .app)
	go build ./...

check: lint test ## What CI runs
	@gofmt -l . | grep -v node_modules | grep . && { echo "gofmt: files need formatting (run 'make fmt')"; exit 1; } || true

hooks: ## Install the pre-commit hook
	@mkdir -p .git/hooks
	@printf '#!/bin/sh\nexec make -s precommit\n' > .git/hooks/pre-commit
	@chmod +x .git/hooks/pre-commit
	@echo "installed .git/hooks/pre-commit -> make precommit"

precommit: ## Fast pre-commit gate: format check + lint
	@gofmt -l . | grep -v node_modules | grep . && { echo "gofmt: run 'make fmt'"; exit 1; } || true
	@$(MAKE) -s lint-go lint-web

clean:
	rm -rf $(FRONTEND)/dist build/bin build/dmg
