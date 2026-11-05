package ble

import (
	"context"
	"errors"
	"fmt"
	"log"
	"sort"
	"strings"
	"sync"
	"time"

	"flintstep/internal/sparkx"
)

// FINDING THE PEDAL. From the BEAM Mini app's blefind.go.
//
// Scanning only finds a pedal that advertises, and a pedal stops advertising once
// anything holds a connection to it. So a connect tries, in order:
//
//  1. the target's address, straight away: CoreBluetooth connects by identifier
//     whether or not the pedal is advertising ("connected-to-system" when the Mac
//     already holds it, "by identifier" otherwise);
//  2. a pedal the Mac already holds: the target's name, when its address did not
//     answer (a Bluetooth reset gives a device a new identifier), or with no target,
//     the first one of a known model;
//  3. a scan for the same, which also catches a pedal whose identifier the Mac has
//     forgotten.
//
// WHAT IS A PEDAL (sparkx/models.go). Before connecting, only names and advertised
// services are visible. Without being asked, the Manager only ever picks a known
// model's name or the remembered address (or, for a remembered pedal that moved, its
// exact name), never a device it merely suspects. Scan lists the suspects too, marked
// unverified, so the user can choose one. Connecting settles it: the pedal must have the
// switch AND the FFC8 command service (gatt_tinygo.go), or the dial fails with
// errIncompatible and the address is not picked by name again.

// connectPath is how a connect found its pedal, for the log.
type connectPath string

const (
	pathSystem     connectPath = "connected-to-system"
	pathIdentifier connectPath = "by identifier"
	pathScan       connectPath = "scan"
)

// errNotFound is a connect attempt that found nothing to connect to.
var errNotFound = errors.New("no pedal found")

// errIncompatible is a device that connected but lacks the switch or the command
// service: not a pedal this app can drive.
var errIncompatible = errors.New("not a compatible pedal")

// nameModel is the model a name says, zero when it says none.
func nameModel(name string) sparkx.ModelInfo {
	if m, ok := sparkx.ModelForName(name); ok {
		return m.Info()
	}
	return sparkx.ModelInfo{}
}

// classify fills in d's Model and Verified from its name, or failing that from the
// services the radio saw.
func classify(d Device) Device {
	d.Model, d.Verified = sparkx.ModelInfo{}, false
	switch m, ok := sparkx.ModelForName(d.Name); {
	case ok:
		d.Model, d.Verified = m.Info(), true
	case sparkx.HasServices(d.services):
		d.Model, d.Verified = sparkx.Compatible.Info(), true
	}
	return d
}

// offers reports whether d was seen offering the service uuid.
func (d Device) offers(uuid string) bool {
	for _, s := range d.services {
		if strings.EqualFold(s, uuid) {
			return true
		}
	}
	return false
}

// listable is what Scan shows: a pedal it knows, or a device that offers the switch or
// the BLE-MIDI service and might be one.
func listable(d Device) bool {
	return d.Verified || d.offers(sparkx.SwitchService) || d.offers(midiService)
}

// Label is how the app names a pedal in a sentence: "Connected to <Label>". The model
// when it is a known one; else the advertised name; else "your pedal".
func Label(name string, model sparkx.ModelInfo) string {
	switch {
	case model.ID != "" && model.ID != sparkx.IDCompatible:
		return model.Name
	case name != "":
		return name
	case model.ID == sparkx.IDCompatible:
		return "a " + model.Name
	}
	return "your pedal"
}

// describe names a target for the log.
func describe(t Target) string {
	switch {
	case t.Address == "" && t.Name == "":
		return "the first known pedal"
	case t.Name == "":
		return t.Address
	case t.Address == "":
		return fmt.Sprintf("%q", t.Name)
	}
	return fmt.Sprintf("%q (%s)", t.Name, t.Address)
}

// connect finds and connects the pedal tg names, returning the started session.
func (m *Manager) connect(ctx context.Context, tg Target) (*session, connectPath, error) {
	held, err := m.r.held()
	if err != nil {
		log.Printf("ble: cannot list the pedals this Mac holds: %v", err)
	}
	for i := range held {
		held[i] = classify(held[i])
	}

	var refused error // the last device that connected but was not a pedal
	try := func(d Device, path connectPath, budget time.Duration) *session {
		if ctx.Err() != nil {
			return nil
		}
		d = classify(d)
		m.showing(d)
		m.setState(StateConnecting, "Connecting to "+Label(d.Name, d.Model))
		log.Printf("ble: connecting to %s %s", describe(Target{d.Address, d.Name}), path)
		s := newSession(m, d)
		c, err := m.r.dial(ctx, d.Address, budget, s)
		if err != nil {
			log.Printf("ble: %s connect to %s failed: %v", path, describe(Target{d.Address, d.Name}), err)
			if errors.Is(err, errIncompatible) {
				m.reject(d.Address)
				refused = fmt.Errorf("%s: %w", Label(d.Name, d.Model), errIncompatible)
			}
			return nil
		}
		s.c = c
		return s
	}

	// 1. The target's own address, without a scan.
	if tg.Address != "" {
		d, path, budget := Device{Name: tg.Name, Address: tg.Address}, pathIdentifier, m.tm.idDial
		if h, ok := findDevice(held, tg.Address); ok {
			path, budget = pathSystem, m.tm.heldDial
			if h.Name != "" {
				d.Name = h.Name
			}
			d.services = h.services
		}
		if s := try(d, path, budget); s != nil {
			return s, path, nil
		}
	}

	// 2. A pedal the Mac holds that matches.
	for _, h := range held {
		if strings.EqualFold(h.Address, tg.Address) {
			continue // tried above
		}
		match := m.pickable(h)
		if tg.Address != "" {
			match = tg.Name != "" && h.Name == tg.Name
		}
		if !match {
			continue
		}
		if s := try(h, pathSystem, m.tm.heldDial); s != nil {
			return s, pathSystem, nil
		}
	}

	// 3. A scan.
	if ctx.Err() != nil {
		return nil, "", ctx.Err()
	}
	m.setState(StateSearching, "Looking for "+lookingFor(tg))
	var (
		mu              sync.Mutex
		found, fallback *Device
	)
	err = m.scan(ctx, m.tm.scanFor, func(a Device) bool {
		a = classify(a)
		exact, byName := m.wants(tg, a)
		if !exact && !byName {
			return false
		}
		mu.Lock()
		defer mu.Unlock()
		res := a
		if byName {
			if fallback == nil {
				fallback = &res
			}
			return false // keep looking for the address itself
		}
		if found == nil {
			found = &res
		}
		return true
	})
	if err != nil {
		return nil, "", fmt.Errorf("scan: %w", err)
	}
	mu.Lock()
	res := found
	if res == nil && fallback != nil {
		res = fallback
		log.Printf("ble: %s not seen; taking %q at %s by its name", tg.Address, tg.Name, res.Address)
	}
	mu.Unlock()
	if res == nil {
		if refused != nil {
			return nil, "", refused
		}
		return nil, "", errNotFound
	}
	log.Printf("ble: found %q %s rssi %d", res.Name, res.Address, res.RSSI)
	// The pedal was advertising a moment ago: the adapter's own timeout.
	if s := try(*res, pathScan, 0); s != nil {
		return s, pathScan, nil
	}
	if ctx.Err() != nil {
		return nil, "", ctx.Err()
	}
	if refused != nil {
		return nil, "", refused
	}
	return nil, "", fmt.Errorf("connect to %s failed", describe(Target{res.Address, res.Name}))
}

// lookingFor names what a connect looks for: the remembered pedal, or any.
func lookingFor(tg Target) string {
	if tg.Address == "" && tg.Name == "" {
		return "your pedal"
	}
	return Label(tg.Name, nameModel(tg.Name))
}

// pickable reports whether d may be connected without the user naming it: a known
// model's name, not already found to be something else.
func (m *Manager) pickable(d Device) bool {
	if !sparkx.IsName(d.Name) {
		return false
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	return !m.rejected[strings.ToLower(d.Address)]
}

// reject remembers that addr connected but was not a compatible pedal.
func (m *Manager) reject(addr string) {
	m.mu.Lock()
	m.rejected[strings.ToLower(addr)] = true
	m.mu.Unlock()
}

// wants is the scan filter: the target's address if there is one, else any pickable
// pedal. byName is the fallback for a target whose address did not show up: a device
// with exactly its name, which is a known model's or comes with the switch service
// (the remembered pedal under a new identifier).
func (m *Manager) wants(tg Target, a Device) (exact, byName bool) {
	if tg.Address == "" {
		return m.pickable(a), false
	}
	if strings.EqualFold(a.Address, tg.Address) {
		return true, false
	}
	same := tg.Name != "" && a.Name == tg.Name
	return false, same && (sparkx.IsName(a.Name) || a.offers(sparkx.SwitchService))
}

func findDevice(ds []Device, addr string) (Device, bool) {
	for _, d := range ds {
		if strings.EqualFold(d.Address, addr) {
			return d, true
		}
	}
	return Device{}, false
}

// scan runs one radio scan, after any other scan of this Manager's has finished.
func (m *Manager) scan(ctx context.Context, timeout time.Duration, visit func(Device) bool) error {
	m.scanMu.Lock()
	defer m.scanMu.Unlock()
	return m.r.scan(ctx, timeout, visit)
}

// Scan lists the pedals in range and those macOS already holds (System set), listening
// for timeout: the known models, and unverified devices that advertise the switch or
// the BLE-MIDI service. It waits for a scan of the reconnect loop's to finish first
// rather than collide with it.
func (m *Manager) Scan(timeout time.Duration) ([]Device, error) {
	if on, detail := m.r.power(); !on {
		return nil, errors.New(detail)
	}
	if err := m.r.enable(); err != nil {
		return nil, fmt.Errorf("enable Bluetooth: %w", err)
	}
	seen := map[string]Device{}
	held, err := m.r.held()
	if err != nil {
		log.Printf("ble: cannot list the pedals this Mac holds: %v", err)
	}
	for _, d := range held {
		d.System = true
		seen[strings.ToLower(d.Address)] = classify(d)
	}
	var mu sync.Mutex
	err = m.scan(context.Background(), timeout, func(a Device) bool {
		a = classify(a)
		if !listable(a) {
			return false
		}
		k := strings.ToLower(a.Address)
		mu.Lock()
		if _, ok := seen[k]; !ok {
			seen[k] = a
		}
		mu.Unlock()
		return false
	})
	if err != nil {
		return nil, fmt.Errorf("scan: %w", err)
	}
	mu.Lock()
	defer mu.Unlock()
	return sortDevices(seen), nil
}

// sortDevices is the held pedals first, then verified ones, then the strongest signal,
// then by name.
func sortDevices(seen map[string]Device) []Device {
	out := make([]Device, 0, len(seen))
	for _, d := range seen {
		out = append(out, d)
	}
	sort.Slice(out, func(i, j int) bool {
		a, b := out[i], out[j]
		if a.System != b.System {
			return a.System
		}
		if a.Verified != b.Verified {
			return a.Verified
		}
		if a.RSSI != b.RSSI {
			return a.RSSI > b.RSSI
		}
		if a.Name != b.Name {
			return a.Name < b.Name
		}
		return a.Address < b.Address
	})
	return out
}

// showing sets the pedal named in the status.
func (m *Manager) showing(d Device) {
	m.mu.Lock()
	m.name, m.addr, m.model = d.Name, d.Address, d.Model
	m.mu.Unlock()
}
