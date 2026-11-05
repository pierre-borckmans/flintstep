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
//  2. a Spark Control X the Mac already holds: the target's name, when its address
//     did not answer (a Bluetooth reset gives a device a new identifier), or with no
//     target, the first one;
//  3. a scan for a name starting "SparkX", which also catches a pedal whose
//     identifier the Mac has forgotten.

// connectPath is how a connect found its pedal, for the log.
type connectPath string

const (
	pathSystem     connectPath = "connected-to-system"
	pathIdentifier connectPath = "by identifier"
	pathScan       connectPath = "scan"
)

// errNotFound is a connect attempt that found nothing to connect to.
var errNotFound = errors.New("no Spark Control X found")

// describe names a target for the log and the UI.
func describe(t Target) string {
	switch {
	case t.Address == "" && t.Name == "":
		return "the first Spark Control X"
	case t.Name == "":
		return t.Address
	case t.Address == "":
		return fmt.Sprintf("%q", t.Name)
	}
	return fmt.Sprintf("%q (%s)", t.Name, t.Address)
}

// shortName is a pedal's name for the UI's detail line.
func shortName(name string) string {
	if name == "" {
		return "the Spark Control X"
	}
	return name
}

// connect finds and connects the pedal tg names, returning the started session.
func (m *Manager) connect(ctx context.Context, tg Target) (*session, connectPath, error) {
	held, err := m.r.held()
	if err != nil {
		log.Printf("ble: cannot list the pedals this Mac holds: %v", err)
	}

	try := func(d Device, path connectPath, budget time.Duration) *session {
		if ctx.Err() != nil {
			return nil
		}
		m.showing(d.Name, d.Address)
		m.setState(StateConnecting, "Connecting to "+shortName(d.Name))
		log.Printf("ble: connecting to %s %s", describe(Target{d.Address, d.Name}), path)
		s := newSession(m, d)
		c, err := m.r.dial(ctx, d.Address, budget, s)
		if err != nil {
			log.Printf("ble: %s connect to %s failed: %v", path, describe(Target{d.Address, d.Name}), err)
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
		match := sparkx.IsName(h.Name)
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
		exact, byName := wants(tg, a)
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
	return nil, "", fmt.Errorf("connect to %s failed", describe(Target{res.Address, res.Name}))
}

func lookingFor(tg Target) string {
	if tg.Address == "" && tg.Name == "" {
		return "a Spark Control X"
	}
	return shortName(tg.Name)
}

// wants is the scan filter: the target's address if there is one (or, as a fallback,
// a pedal with exactly the target's name), else any Spark Control X.
func wants(tg Target, a Device) (exact, byName bool) {
	if tg.Address == "" {
		return sparkx.IsName(a.Name), false
	}
	if strings.EqualFold(a.Address, tg.Address) {
		return true, false
	}
	return false, tg.Name != "" && a.Name == tg.Name && sparkx.IsName(a.Name)
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

// Scan lists the Spark Control X pedals in range and those macOS already holds
// (System set), listening for timeout. It waits for a scan of the reconnect loop's to
// finish first rather than collide with it.
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
		seen[strings.ToLower(d.Address)] = d
	}
	var mu sync.Mutex
	err = m.scan(context.Background(), timeout, func(a Device) bool {
		if !sparkx.IsName(a.Name) {
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

// sortDevices is the held pedals first, then the strongest signal, then by name.
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
func (m *Manager) showing(name, addr string) {
	m.mu.Lock()
	m.name, m.addr = name, addr
	m.mu.Unlock()
}
