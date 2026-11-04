package ble

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"
)

const pedalID = "963a48e7-fa93-cabe-a00b-59d7693df2a9"

func findWith(t *testing.T, air *fakeAir, tg Target) (*session, connectPath, error) {
	t.Helper()
	m := newManager(Handlers{}, air, fastTiming)
	return m.connect(context.Background(), tg)
}

// A remembered pedal the Mac holds connects at once, with the long budget, no scan.
func TestHeldPedalConnectsWithoutAScan(t *testing.T) {
	air := &fakeAir{
		system:  []Device{{Name: "SparkX v4.1.23 fbfc", Address: pedalID, System: true}},
		answers: map[string]bool{pedalID: true},
	}
	s, path, err := findWith(t, air, Target{Address: pedalID, Name: "SparkX old name"})
	if err != nil {
		t.Fatal(err)
	}
	if air.scans != 0 || len(air.dials) != 1 || air.dials[0] != pedalID {
		t.Errorf("scans %d, dials %v; want one dial and no scan", air.scans, air.dials)
	}
	if path != pathSystem || air.budgets[0] != fastTiming.heldDial {
		t.Errorf("path %s budget %v", path, air.budgets[0])
	}
	if s.dev.Name != "SparkX v4.1.23 fbfc" {
		t.Errorf("name %q, want the name the Mac knows", s.dev.Name)
	}
}

// A remembered pedal the Mac does not hold is still tried by identifier first.
func TestRememberedPedalByIdentifierFirst(t *testing.T) {
	air := &fakeAir{answers: map[string]bool{"pedal": true}}
	_, path, err := findWith(t, air, Target{Address: "pedal", Name: "SparkX a"})
	if err != nil {
		t.Fatal(err)
	}
	if air.scans != 0 || len(air.dials) != 1 || path != pathIdentifier || air.budgets[0] != fastTiming.idDial {
		t.Errorf("scans %d, dials %v, path %s, budget %v", air.scans, air.dials, path, air.budgets[0])
	}
}

// The identifier does not answer (a Bluetooth reset gave the pedal a new one): the scan
// finds it by name.
func TestIdentifierFailsThenScanByName(t *testing.T) {
	air := &fakeAir{
		adverts: []Device{
			{Name: "SparkX other", Address: "other", RSSI: -40},
			{Name: "SparkX mine", Address: "new", RSSI: -50},
		},
		answers: map[string]bool{"new": true, "other": true},
	}
	s, path, err := findWith(t, air, Target{Address: "old", Name: "SparkX mine"})
	if err != nil {
		t.Fatal(err)
	}
	if air.scans != 1 || len(air.dials) != 2 || air.dials[0] != "old" || air.dials[1] != "new" {
		t.Errorf("scans %d, dials %v", air.scans, air.dials)
	}
	if path != pathScan || s.dev.Address != "new" {
		t.Errorf("path %s dev %+v", path, s.dev)
	}
}

// Same, but the Mac holds the pedal under its new identifier: no scan.
func TestIdentifierFailsThenHeldByName(t *testing.T) {
	air := &fakeAir{
		system:  []Device{{Name: "SparkX mine", Address: "new", System: true}},
		answers: map[string]bool{"new": true},
	}
	_, path, err := findWith(t, air, Target{Address: "old", Name: "SparkX mine"})
	if err != nil {
		t.Fatal(err)
	}
	if air.scans != 0 || len(air.dials) != 2 || air.dials[1] != "new" || path != pathSystem {
		t.Errorf("scans %d, dials %v, path %s", air.scans, air.dials, path)
	}
}

// No target: the first SparkX the Mac holds; other held devices are not candidates.
func TestNoTargetTakesFirstHeldSparkX(t *testing.T) {
	air := &fakeAir{
		system: []Device{
			{Name: "BT500S-2", Address: "airturn", System: true},
			{Name: "SparkX v4", Address: "sx", System: true},
		},
		answers: map[string]bool{"sx": true, "airturn": true},
	}
	if _, _, err := findWith(t, air, Target{}); err != nil {
		t.Fatal(err)
	}
	if air.scans != 0 || len(air.dials) != 1 || air.dials[0] != "sx" {
		t.Errorf("scans %d, dials %v", air.scans, air.dials)
	}
}

// No target, nothing held: the scan takes the first advertised SparkX.
func TestNoTargetScansForSparkX(t *testing.T) {
	air := &fakeAir{
		adverts: []Device{{Name: "BEAM CONTROL", Address: "bc"}, {Name: "SparkX v4", Address: "sx"}},
		answers: map[string]bool{"sx": true, "bc": true},
	}
	_, path, err := findWith(t, air, Target{})
	if err != nil {
		t.Fatal(err)
	}
	if len(air.dials) != 1 || air.dials[0] != "sx" || path != pathScan {
		t.Errorf("dials %v path %s", air.dials, path)
	}
}

func TestNotFoundAnywhere(t *testing.T) {
	logs := captureLog(t)
	air := &fakeAir{}
	_, _, err := findWith(t, air, Target{Address: "gone", Name: "SparkX gone"})
	if !errors.Is(err, errNotFound) {
		t.Fatalf("err = %v", err)
	}
	if strings.Contains(logs.String(), `""`) {
		t.Errorf("empty fields in the log:\n%s", logs)
	}
}

// A stopped Manager does not dial.
func TestCancelledConnectDoesNotDial(t *testing.T) {
	air := &fakeAir{answers: map[string]bool{"a": true}}
	m := newManager(Handlers{}, air, fastTiming)
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, _, err := m.connect(ctx, Target{Address: "a"}); err == nil {
		t.Fatal("connected after cancel")
	}
	if len(air.dials) != 0 {
		t.Errorf("dials %v", air.dials)
	}
}

func TestDescribe(t *testing.T) {
	for _, c := range []struct {
		tg   Target
		want string
	}{
		{Target{}, "the first Spark Control X"},
		{Target{Address: "a1"}, "a1"},
		{Target{Name: "SparkX"}, `"SparkX"`},
		{Target{Address: "a1", Name: "SparkX"}, `"SparkX" (a1)`},
	} {
		if got := describe(c.tg); got != c.want {
			t.Errorf("describe(%+v) = %s, want %s", c.tg, got, c.want)
		}
	}
}

// Scan lists held pedals (System) first and advertising SparkX pedals, nothing else.
func TestScanListsHeldAndInRange(t *testing.T) {
	air := &fakeAir{
		system: []Device{{Name: "SparkX held", Address: "H"}},
		adverts: []Device{
			{Name: "SparkX near", Address: "n", RSSI: -40},
			{Name: "SparkX far", Address: "f", RSSI: -80},
			{Name: "Other", Address: "o", RSSI: -10},
			{Name: "SparkX held", Address: "h", RSSI: -30}, // the same pedal, as a scan spells it
		},
	}
	m := newManager(Handlers{}, air, fastTiming)
	ds, err := m.Scan(10 * time.Millisecond)
	if err != nil {
		t.Fatal(err)
	}
	var got []string
	for _, d := range ds {
		got = append(got, d.Address)
	}
	if strings.Join(got, ",") != "H,n,f" || !ds[0].System || ds[1].System {
		t.Errorf("Scan = %+v", ds)
	}
}

func TestScanWithBluetoothOff(t *testing.T) {
	air := &fakeAir{off: "Bluetooth is off"}
	m := newManager(Handlers{}, air, fastTiming)
	if _, err := m.Scan(time.Millisecond); err == nil || err.Error() != "Bluetooth is off" {
		t.Errorf("err = %v", err)
	}
}
