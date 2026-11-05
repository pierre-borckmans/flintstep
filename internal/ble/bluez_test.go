package ble

import (
	"errors"
	"fmt"
	"reflect"
	"strings"
	"testing"

	"github.com/godbus/dbus/v5"
)

func adapterObj(powered bool, state string) map[string]map[string]dbus.Variant {
	p := map[string]dbus.Variant{"Powered": dbus.MakeVariant(powered), "Address": dbus.MakeVariant("00:11:22:33:44:55")}
	if state != "" {
		p["PowerState"] = dbus.MakeVariant(state)
	}
	return map[string]map[string]dbus.Variant{bluezAdapter: p}
}

func deviceObj(name, addr string, connected bool, uuids ...string) map[string]map[string]dbus.Variant {
	return map[string]map[string]dbus.Variant{bluezDevice: {
		"Name":      dbus.MakeVariant(name),
		"Alias":     dbus.MakeVariant(name),
		"Address":   dbus.MakeVariant(addr),
		"Connected": dbus.MakeVariant(connected),
		"UUIDs":     dbus.MakeVariant(uuids),
	}}
}

func TestPickAdapter(t *testing.T) {
	if _, ok := pickAdapter(bluezObjects{"/org/bluez": {"org.bluez.AgentManager1": {}}}); ok {
		t.Fatal("found an adapter where there is none")
	}
	objs := bluezObjects{
		"/org/bluez/hci2": adapterObj(true, ""),
		"/org/bluez/hci1": adapterObj(false, ""),
	}
	a, ok := pickAdapter(objs)
	if !ok || a.ID != "hci2" || !a.Powered {
		t.Fatalf("no hci0: want the powered hci2, got %+v %v", a, ok)
	}
	objs["/org/bluez/hci0"] = adapterObj(false, "off-blocked")
	a, _ = pickAdapter(objs)
	if a.ID != "hci0" || a.Path != "/org/bluez/hci0" || a.PowerState != "off-blocked" {
		t.Fatalf("hci0 exists: want it, got %+v", a)
	}
	delete(objs, "/org/bluez/hci0")
	delete(objs, "/org/bluez/hci2")
	if a, _ = pickAdapter(objs); a.ID != "hci1" {
		t.Fatalf("only an unpowered adapter: want it anyway, got %+v", a)
	}
}

func TestAdapterDetail(t *testing.T) {
	for _, c := range []struct {
		a      bluezAdapterInfo
		on     bool
		detail string
	}{
		{bluezAdapterInfo{Powered: true, PowerState: "on"}, true, ""},
		{bluezAdapterInfo{Powered: false, PowerState: "off"}, false, "Bluetooth is off"},
		{bluezAdapterInfo{Powered: false}, false, "Bluetooth is off"},
		{bluezAdapterInfo{Powered: false, PowerState: "off-blocked"}, false, "rfkill"},
	} {
		on, detail := adapterDetail(c.a)
		if on != c.on || !strings.Contains(detail, c.detail) || (c.detail == "" && detail != "") {
			t.Errorf("%+v: got %v %q, want %v ~%q", c.a, on, detail, c.on, c.detail)
		}
	}
}

func TestBusErrorDetail(t *testing.T) {
	for _, c := range []struct {
		err  error
		want string
	}{
		{dbus.Error{Name: "org.freedesktop.DBus.Error.ServiceUnknown"}, detailNoBlueZ},
		{&dbus.Error{Name: "org.freedesktop.DBus.Error.ServiceUnknown"}, detailNoBlueZ},
		{fmt.Errorf("call: %w", dbus.Error{Name: "org.freedesktop.DBus.Error.AccessDenied"}), detailNotAllowed},
		{dbus.Error{Name: "org.freedesktop.DBus.Error.UnknownObject"}, detailNoAdapter},
		// Seen in the smoke test: bluez installed, bluetoothd not running, activation fails.
		{dbus.Error{Name: "org.freedesktop.DBus.Error.Spawn.ChildExited"}, detailNoBlueZ},
		{dbus.Error{Name: "org.freedesktop.systemd1.UnitMasked"}, detailNoBlueZ},
		{dbus.Error{Name: "org.example.Weird"}, "Bluetooth is unavailable: org.example.Weird"},
		{errors.New("dial unix /var/run/dbus/system_bus_socket: connect: no such file or directory"), detailNoBus},
	} {
		if got := busErrorDetail(c.err); got != c.want {
			t.Errorf("%v: got %q, want %q", c.err, got, c.want)
		}
	}
}

func TestDevicePath(t *testing.T) {
	if got := devicePath("/org/bluez/hci0", "aa:bb:cc:dd:ee:0f"); got != "/org/bluez/hci0/dev_AA_BB_CC_DD_EE_0F" {
		t.Fatal(got)
	}
}

func TestHeldPedals(t *testing.T) {
	switchSvc := "7bdb8dc0-6c95-11e3-981f-0800200c9a66"
	midi := "03b80e5a-ede8-4b33-a751-6ce34ec4c700"
	objs := bluezObjects{
		"/org/bluez/hci0":                            adapterObj(true, "on"),
		"/org/bluez/hci0/dev_AA_00_00_00_00_02":      deviceObj("SparkX-B", "AA:00:00:00:00:02", true, midi),
		"/org/bluez/hci0/dev_AA_00_00_00_00_01":      deviceObj("SparkX-A", "aa:00:00:00:00:01", true, "0000180f-0000-1000-8000-00805f9b34fb", switchSvc),
		"/org/bluez/hci0/dev_AA_00_00_00_00_03":      deviceObj("SparkX-C", "AA:00:00:00:00:03", false, switchSvc), // not connected
		"/org/bluez/hci0/dev_AA_00_00_00_00_04":      deviceObj("Headphones", "AA:00:00:00:00:04", true, midi),     // not a pedal
		"/org/bluez/hci0/dev_AA_00_00_00_00_05":      deviceObj("SparkX-E", "AA:00:00:00:00:05", true),             // no UUIDs yet
		"/org/bluez/hci1/dev_AA_00_00_00_00_06":      deviceObj("SparkX-F", "AA:00:00:00:00:06", true, switchSvc),  // other adapter
		"/org/bluez/hci0/dev_AA_00_00_00_00_01/svc1": {"org.bluez.GattService1": {}},
	}
	want := []Device{
		{Name: "SparkX-A", Address: "AA:00:00:00:00:01", System: true},
		{Name: "SparkX-B", Address: "AA:00:00:00:00:02", System: true},
	}
	if got := heldPedals(objs, "/org/bluez/hci0"); !reflect.DeepEqual(got, want) {
		t.Fatalf("got %+v\nwant %+v", got, want)
	}
	// A device with no Name falls back to its Alias.
	d := deviceObj("", "AA:00:00:00:00:07", true, switchSvc)
	d[bluezDevice]["Alias"] = dbus.MakeVariant("SparkX-G")
	got := heldPedals(bluezObjects{"/org/bluez/hci0/dev_AA_00_00_00_00_07": d}, "/org/bluez/hci0")
	if len(got) != 1 || got[0].Name != "SparkX-G" {
		t.Fatalf("alias fallback: %+v", got)
	}
}

func TestDeviceGone(t *testing.T) {
	path := dbus.ObjectPath("/org/bluez/hci0/dev_AA_00_00_00_00_01")
	changed := func(p dbus.ObjectPath, iface string, props map[string]dbus.Variant) *dbus.Signal {
		return &dbus.Signal{Path: p, Name: dbusProperties + ".PropertiesChanged", Body: []any{iface, props, []string{}}}
	}
	for _, c := range []struct {
		name string
		sig  *dbus.Signal
		want bool
	}{
		{"nil", nil, false},
		{"disconnected", changed(path, bluezDevice, map[string]dbus.Variant{"Connected": dbus.MakeVariant(false)}), true},
		{"connected", changed(path, bluezDevice, map[string]dbus.Variant{"Connected": dbus.MakeVariant(true)}), false},
		{"rssi only", changed(path, bluezDevice, map[string]dbus.Variant{"RSSI": dbus.MakeVariant(int16(-50))}), false},
		{"other device", changed(path+"0", bluezDevice, map[string]dbus.Variant{"Connected": dbus.MakeVariant(false)}), false},
		{"characteristic value", changed(path+"/service0010/char0011", "org.bluez.GattCharacteristic1", map[string]dbus.Variant{"Value": dbus.MakeVariant([]byte{1})}), false},
		{"removed", &dbus.Signal{Name: "org.freedesktop.DBus.ObjectManager.InterfacesRemoved", Body: []any{path, []string{bluezDevice}}}, true},
		{"service removed", &dbus.Signal{Name: "org.freedesktop.DBus.ObjectManager.InterfacesRemoved", Body: []any{path + "/service0010", []string{"org.bluez.GattService1"}}}, false},
		{"short body", &dbus.Signal{Path: path, Name: dbusProperties + ".PropertiesChanged", Body: []any{bluezDevice}}, false},
	} {
		if got := deviceGone(c.sig, path); got != c.want {
			t.Errorf("%s: got %v, want %v", c.name, got, c.want)
		}
	}
}
