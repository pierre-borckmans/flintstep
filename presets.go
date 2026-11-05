package main

import (
	"errors"
	"fmt"
	"io"
	"log"
	"os"

	"github.com/wailsapp/wails/v2/pkg/runtime"

	"flintstep/internal/mapping"
	"flintstep/internal/presets"
	"flintstep/internal/product"
	"flintstep/internal/store"
)

// PRESETS: the bound methods over the preset library. Every one runs under cfgMu, like
// every other config write, so the library's active preset and the bridge's config move
// together.

// PresetInfo is a preset as the UI lists it.
type PresetInfo = presets.Info

// maxImport is the largest file ImportPreset reads: a preset is a few kilobytes.
const maxImport = 1 << 20

// fileDialogs are the native open and save panels. Tests replace them; "" is a cancel.
type fileDialogs interface {
	SaveFile(defaultName string) (string, error)
	OpenFile() (string, error)
}

type wailsDialogs struct{ app *App }

var jsonFilter = []runtime.FileFilter{{DisplayName: product.Name + " preset (*.json)", Pattern: "*.json"}}

func (d wailsDialogs) SaveFile(name string) (string, error) {
	return runtime.SaveFileDialog(d.app.ctx, runtime.SaveDialogOptions{
		Title:                "Export preset",
		DefaultFilename:      name,
		Filters:              jsonFilter,
		CanCreateDirectories: true,
	})
}

func (d wailsDialogs) OpenFile() (string, error) {
	return runtime.OpenFileDialog(d.app.ctx, runtime.OpenDialogOptions{
		Title:   "Import preset",
		Filters: jsonFilter,
	})
}

// ListPresets is every preset, in library order.
func (a *App) ListPresets() []PresetInfo { return a.lib.List() }

// SelectPreset makes preset id the active one and runs it.
func (a *App) SelectPreset(id string) (mapping.Config, error) {
	a.cfgMu.Lock()
	defer a.cfgMu.Unlock()
	prev := a.lib.ActiveID()
	cfg, err := a.lib.Select(id)
	if err != nil {
		return a.bridge.Config(), err
	}
	applied, err := a.bridge.Apply(cfg)
	if err != nil {
		// The bridge kept the old mapping, so the library goes back to it too.
		if _, rerr := a.lib.Select(prev); rerr != nil {
			log.Printf("presets: %v", rerr)
		}
		return a.bridge.Config(), err
	}
	a.changed()
	return applied, nil
}

// CreatePreset adds a preset copied from the active one (from "current") or the
// default mapping ("default"). A blank name picks "New preset", made unique. The new
// preset is not activated: the UI selects it, so the switch is an undoable step.
func (a *App) CreatePreset(name, from string) (PresetInfo, error) {
	a.cfgMu.Lock()
	defer a.cfgMu.Unlock()
	defer a.changed()
	return a.lib.Create(name, from)
}

// RenamePreset renames preset id.
func (a *App) RenamePreset(id, name string) error {
	a.cfgMu.Lock()
	defer a.cfgMu.Unlock()
	defer a.changed()
	return a.lib.Rename(id, name)
}

// DuplicatePreset adds "<name> copy" of preset id, not activated.
func (a *App) DuplicatePreset(id string) (PresetInfo, error) {
	a.cfgMu.Lock()
	defer a.cfgMu.Unlock()
	defer a.changed()
	return a.lib.Duplicate(id)
}

// DeletePreset removes preset id; the last one cannot go. Deleting the active one
// runs its neighbour.
func (a *App) DeletePreset(id string) error {
	a.cfgMu.Lock()
	defer a.cfgMu.Unlock()
	defer a.changed()
	was := a.lib.ActiveID()
	if err := a.lib.Delete(id); err != nil {
		return err
	}
	if a.lib.ActiveID() != was {
		if _, err := a.bridge.Apply(a.lib.Active()); err != nil {
			return fmt.Errorf("deleted, but the next preset cannot run: %w", err)
		}
	}
	return nil
}

// ExportPreset asks where to save preset id and writes it there. A cancel is no error.
func (a *App) ExportPreset(id string) error {
	data, name, err := a.lib.Export(id)
	if err != nil {
		return err
	}
	path, err := a.dialogs.SaveFile(name)
	if err != nil || path == "" {
		return err
	}
	if err := store.WriteAtomic(path, data); err != nil {
		return fmt.Errorf("exporting the preset: %w", err)
	}
	log.Printf("presets: exported %q to %s", name, path)
	return nil
}

// ImportPreset asks for a preset file and adds it, not activated. A cancel returns a
// zero PresetInfo (id "") and no error.
func (a *App) ImportPreset() (PresetInfo, error) {
	path, err := a.dialogs.OpenFile()
	if err != nil || path == "" {
		return PresetInfo{}, err
	}
	data, err := readSmall(path, maxImport)
	if err != nil {
		return PresetInfo{}, err
	}
	a.cfgMu.Lock()
	defer a.cfgMu.Unlock()
	defer a.changed()
	info, err := a.lib.Import(data, path)
	if err == nil {
		log.Printf("presets: imported %q from %s", info.Name, path)
	}
	return info, err
}

func readSmall(path string, limit int64) ([]byte, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, fmt.Errorf("opening the preset: %w", err)
	}
	defer f.Close()
	b, err := io.ReadAll(io.LimitReader(f, limit+1))
	if err != nil {
		return nil, fmt.Errorf("reading the preset: %w", err)
	}
	if int64(len(b)) > limit {
		return nil, errors.New("this file is too big to be a preset")
	}
	return b, nil
}
