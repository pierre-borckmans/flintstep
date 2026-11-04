# SparkX MIDI: dev tasks. Tooling: Go + golangci-lint, bun + Biome, Wails v2.
# `make check` is what CI runs; run it before you push.

FRONTEND := frontend
BUN      := cd $(FRONTEND) && bun
GOLANGCI := golangci-lint
WAILS    := wails

.DEFAULT_GOAL := help
.PHONY: help install dist icon dev app cli frontend fmt fmt-go fmt-web lint lint-go lint-web \
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

dev: ## Run the app with live reload
	$(WAILS) dev

app: ## Build build/bin/SparkX MIDI.app
	$(WAILS) build -clean

cli: dist ## Build the headless bridge (milestone 1) into build/bin/sparkx-midi
	go build -o build/bin/sparkx-midi ./cmd/sparkx-midi

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
	rm -rf $(FRONTEND)/dist build/bin
