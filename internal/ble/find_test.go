package ble

import (
	"context"
	"errors"
	"strings"
	"sync"
	"testing"
	"time"

	"flintstep/internal/sparkx"
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
		{Target{}, "the first known pedal"},
		{Target{Address: "a1"}, "a1"},
		{Target{Name: "SparkX"}, `"SparkX"`},
		{Target{Address: "a1", Name: "SparkX"}, `"SparkX" (a1)`},
	} {
		if got := describe(c.tg); got != c.want {
			t.Errorf("describe(%+v) = %s, want %s", c.tg, got, c.want)
		}
	}
}

// Scan lists held pedals (System) first and advertising known pedals; a device with an
// unknown name and no pedal service is not listed.
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

// The services seen in advertisements and in the system's list.
var (
	swSvc   = strings.ToLower(sparkx.SwitchService)
	cmdSvc  = sparkx.CommandServiceUUID
	midiSvc = strings.ToLower(midiService)
)

func TestClassify(t *testing.T) {
	for _, c := range []struct {
		name     string
		d        Device
		model    string
		verified bool
	}{
		{"spark by name", Device{Name: "SparkX v4.1.23 fbfc"}, sparkx.IDSparkControlX, true},
		{"reactor by name", Device{Name: "REACTOR Control 01"}, sparkx.IDReactorControl, true},
		{"both services, unknown name", Device{Name: "AT-FS6", services: []string{swSvc, cmdSvc}}, sparkx.IDCompatible, true},
		{"switch service only (BT500S)", Device{Name: "BT500S-2", services: []string{swSvc}}, "", false},
		{"BLE-MIDI only", Device{Name: "Keys", services: []string{midiSvc}}, "", false},
		{"nothing", Device{Name: "Headphones"}, "", false},
	} {
		got := classify(c.d)
		if got.Model.ID != c.model || got.Verified != c.verified {
			t.Errorf("%s: model %q verified %v, want %q %v", c.name, got.Model.ID, got.Verified, c.model, c.verified)
		}
	}
}

func TestLabel(t *testing.T) {
	for _, c := range []struct {
		name  string
		model sparkx.ModelInfo
		want  string
	}{
		{"REACTOR Control 01", sparkx.ReactorControl.Info(), "REACTOR Control"},
		{"SparkX v4", sparkx.SparkControlX.Info(), "Spark Control X"},
		{"AT-FS6", sparkx.Compatible.Info(), "AT-FS6"},
		{"", sparkx.Compatible.Info(), "a compatible AirTurn-based pedal"},
		{"Mystery", sparkx.ModelInfo{}, "Mystery"},
		{"", sparkx.ModelInfo{}, "your pedal"},
	} {
		if got := Label(c.name, c.model); got != c.want {
			t.Errorf("Label(%q, %v) = %q, want %q", c.name, c.model, got, c.want)
		}
	}
}

// A REACTOR Control is found by name like a Spark Control X.
func TestNoTargetScansForReactor(t *testing.T) {
	air := &fakeAir{
		adverts: []Device{{Name: "REACTOR 50 BT Control", Address: "amp"}, {Name: "REACTOR Control 7f", Address: "rc"}},
		answers: map[string]bool{"rc": true, "amp": true},
	}
	s, _, err := findWith(t, air, Target{})
	if err != nil {
		t.Fatal(err)
	}
	if len(air.dials) != 1 || air.dials[0] != "rc" {
		t.Errorf("dials %v", air.dials)
	}
	if s.dev.Model.ID != sparkx.IDReactorControl {
		t.Errorf("model %+v", s.dev.Model)
	}
}

// With nothing remembered, an unverified device is never connected on its own: not one
// advertising the switch service, not one the Mac holds with both services under an
// unknown name. Only a known model's name is picked.
func TestNoTargetNeverPicksUnverified(t *testing.T) {
	air := &fakeAir{
		system: []Device{{Name: "AT-FS6", Address: "held-compatible", System: true, services: []string{swSvc, cmdSvc}}},
		adverts: []Device{
			{Name: "BT500S-2", Address: "bt500", services: []string{swSvc}},
			{Name: "Mystery", Address: "midi", services: []string{midiSvc}},
			{Name: "", Address: "anon", services: []string{swSvc, midiSvc}},
		},
		answers: map[string]bool{"held-compatible": true, "bt500": true, "midi": true, "anon": true},
	}
	_, _, err := findWith(t, air, Target{})
	if !errors.Is(err, errNotFound) {
		t.Fatalf("err = %v, want not found", err)
	}
	if len(air.dials) != 0 {
		t.Errorf("dialled %v", air.dials)
	}
}

// A remembered address is dialled whatever its name, and the dial's service check
// decides: both services connect as a compatible pedal.
func TestRememberedUnknownNameAcceptedByServices(t *testing.T) {
	rec := &recorder{}
	air := &fakeAir{
		answers: map[string]bool{"x": true},
		gatt:    map[string][]string{"x": {swSvc, cmdSvc, midiSvc}},
	}
	m := newManager(rec.handlers(), air, fastTiming)
	var got Device
	var mu sync.Mutex
	m.OnConnected(func(d Device) { mu.Lock(); got = d; mu.Unlock() })
	m.Start(Target{Address: "x", Name: "AT-FS6"})
	defer m.Stop()
	waitFor(t, "connected", func() bool { return m.Status().State == StateConnected })
	st := m.Status()
	if st.Model.ID != sparkx.IDCompatible || st.Detail != "Connected to AT-FS6" {
		t.Errorf("status model %+v detail %q", st.Model, st.Detail)
	}
	mu.Lock()
	defer mu.Unlock()
	if !got.Verified || got.Model.ID != sparkx.IDCompatible {
		t.Errorf("OnConnected got %+v", got)
	}
}

// The switch service alone (an AirTurn BT500S) is refused after connecting, the status
// says so, and it is not connected.
func TestSwitchServiceAloneRejected(t *testing.T) {
	rec := &recorder{}
	air := &fakeAir{
		answers: map[string]bool{"bt500": true},
		gatt:    map[string][]string{"bt500": {swSvc, midiSvc}},
	}
	m := newManager(rec.handlers(), air, fastTiming)
	m.Start(Target{Address: "bt500", Name: "BT500S-2"})
	waitFor(t, "the refusal", func() bool {
		rec.mu.Lock()
		defer rec.mu.Unlock()
		for _, s := range rec.states {
			if strings.HasPrefix(s.Detail, "BT500S-2: not a compatible pedal") {
				return true
			}
		}
		return false
	})
	m.Stop()
	if air.connCount() != 0 || rec.sawState(StateConnected, "") {
		t.Errorf("connected to a page turner")
	}
}

// A known name whose device turns out not to be a pedal is not picked again by name.
func TestRejectedAddressNotPickedAgain(t *testing.T) {
	air := &fakeAir{
		system:  []Device{{Name: "REACTOR Control", Address: "fake", System: true}},
		adverts: []Device{{Name: "SparkX v4", Address: "sx"}},
		answers: map[string]bool{"fake": true, "sx": true},
		gatt:    map[string][]string{"fake": {midiSvc}},
	}
	m := newManager(Handlers{}, air, fastTiming)
	if _, _, err := m.connect(context.Background(), Target{}); err != nil {
		t.Fatal(err) // the held one is refused, the scan finds the Spark Control X
	}
	if d := air.dialled(); len(d) != 2 || d[0] != "fake" || d[1] != "sx" {
		t.Fatalf("first connect dialled %v", d)
	}
	if _, _, err := m.connect(context.Background(), Target{}); err != nil {
		t.Fatal(err)
	}
	if d := air.dialled(); len(d) != 3 || d[2] != "sx" {
		t.Errorf("second connect dialled %v, want sx alone", d)
	}
}

// Nothing found but a device that refused: the error says which, not "not found".
func TestOnlyIncompatibleFound(t *testing.T) {
	air := &fakeAir{
		adverts: []Device{{Name: "REACTOR Control", Address: "fake"}},
		answers: map[string]bool{"fake": true},
		gatt:    map[string][]string{"fake": {swSvc}},
	}
	_, _, err := findWith(t, air, Target{})
	if !errors.Is(err, errIncompatible) || !strings.HasPrefix(err.Error(), "REACTOR Control:") {
		t.Fatalf("err = %v", err)
	}
}

// A remembered pedal with an unknown name that moved to a new identifier is found by
// its exact name, but only with the switch service advertised.
func TestRememberedUnknownNameFallback(t *testing.T) {
	air := &fakeAir{
		adverts: []Device{
			{Name: "AT-FS6", Address: "imposter"}, // same name, no service: not taken
			{Name: "AT-FS6", Address: "new", services: []string{swSvc}},
		},
		answers: map[string]bool{"new": true, "imposter": true},
	}
	s, _, err := findWith(t, air, Target{Address: "old", Name: "AT-FS6"})
	if err != nil {
		t.Fatal(err)
	}
	if s.dev.Address != "new" {
		t.Errorf("took %s", s.dev.Address)
	}
}

// Scan lists unverified devices that advertise the switch or BLE-MIDI service, after the
// verified ones, with models filled in.
func TestScanListsUnverified(t *testing.T) {
	air := &fakeAir{
		system: []Device{{Name: "AT-FS6", Address: "c", services: []string{swSvc, cmdSvc}}},
		adverts: []Device{
			{Name: "REACTOR Control", Address: "r", RSSI: -70},
			{Name: "BT500S-2", Address: "b", RSSI: -30, services: []string{swSvc}},
			{Name: "Keys", Address: "k", RSSI: -40, services: []string{midiSvc}},
			{Name: "Phone", Address: "p", RSSI: -20},
		},
	}
	m := newManager(Handlers{}, air, fastTiming)
	ds, err := m.Scan(10 * time.Millisecond)
	if err != nil {
		t.Fatal(err)
	}
	var got []string
	for _, d := range ds {
		v := "?"
		if d.Verified {
			v = d.Model.ID
		}
		got = append(got, d.Address+"="+v)
	}
	if want := "c=compatible,r=reactor-control,b=?,k=?"; strings.Join(got, ",") != want {
		t.Errorf("Scan = %s, want %s", strings.Join(got, ","), want)
	}
}

// The status names the remembered pedal's model before it connects, none when nothing
// is remembered.
func TestStatusModelFromTarget(t *testing.T) {
	m := newManager(Handlers{}, &fakeAir{off: "Bluetooth is off"}, fastTiming)
	m.SetTarget(Target{Address: "a", Name: "REACTOR Control 1"})
	if st := m.Status(); st.Model.ID != sparkx.IDReactorControl {
		t.Errorf("model %+v", st.Model)
	}
	m.SetTarget(Target{})
	if st := m.Status(); st.Model.ID != "" {
		t.Errorf("model %+v after forgetting", st.Model)
	}
}
