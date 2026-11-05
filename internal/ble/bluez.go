package ble

import (
	"errors"
	"sort"
	"strings"

	"github.com/godbus/dbus/v5"

	"flintstep/internal/sparkx"
)

// BLUEZ, THE PURE PART. radio_linux.go talks to BlueZ over the system D-Bus; what it
// makes of the answers is here, without a bus, so it is tested on any OS (bluez_test.go).
//
// BlueZ publishes everything it knows as objects under /org/bluez: an adapter at
// /org/bluez/hciN (interface org.bluez.Adapter1), each device it has seen below it at
// /org/bluez/hciN/dev_AA_BB_CC_DD_EE_FF (org.bluez.Device1). GetManagedObjects on "/"
// returns them all at once, as bluezObjects.

// bluezObjects is ObjectManager.GetManagedObjects' answer: path -> interface -> property.
type bluezObjects = map[dbus.ObjectPath]map[string]map[string]dbus.Variant

const (
	bluezService   = "org.bluez"
	bluezAdapter   = "org.bluez.Adapter1"
	bluezDevice    = "org.bluez.Device1"
	dbusProperties = "org.freedesktop.DBus.Properties"
)

// bluezAdapterInfo is one adapter as power() and enable() need it.
type bluezAdapterInfo struct {
	ID         string          // "hci0": what tinygo's NewAdapter takes
	Path       dbus.ObjectPath // "/org/bluez/hci0"
	Powered    bool
	PowerState string // BlueZ 5.66+: "on", "off", "off-enabling", "on-disabling", "off-blocked"; "" before
}

// pickAdapter chooses the adapter to use: hci0 when it exists (tinygo's own default),
// else the first powered one, else the first. ok is false when BlueZ has none.
func pickAdapter(objs bluezObjects) (bluezAdapterInfo, bool) {
	var all []bluezAdapterInfo
	for path, ifaces := range objs {
		props, ok := ifaces[bluezAdapter]
		if !ok {
			continue
		}
		a := bluezAdapterInfo{Path: path, ID: string(path[strings.LastIndexByte(string(path), '/')+1:])}
		a.Powered, _ = props["Powered"].Value().(bool)
		a.PowerState, _ = props["PowerState"].Value().(string)
		all = append(all, a)
	}
	if len(all) == 0 {
		return bluezAdapterInfo{}, false
	}
	sort.Slice(all, func(i, j int) bool { return all[i].Path < all[j].Path })
	for _, a := range all {
		if a.ID == "hci0" {
			return a, true
		}
	}
	for _, a := range all {
		if a.Powered {
			return a, true
		}
	}
	return all[0], true
}

// adapterDetail is power()'s answer for an adapter BlueZ has.
func adapterDetail(a bluezAdapterInfo) (on bool, detail string) {
	if a.Powered {
		return true, ""
	}
	if a.PowerState == "off-blocked" {
		return false, "Bluetooth is blocked by rfkill: run `rfkill unblock bluetooth`"
	}
	return false, "Bluetooth is off"
}

// Words for the UI when BlueZ cannot be asked at all.
const (
	detailNoBus      = "Cannot reach the system D-Bus, so Bluetooth is unavailable"
	detailNoBlueZ    = "The Bluetooth service is not running: start it with `sudo systemctl start bluetooth`"
	detailNoAdapter  = "No Bluetooth adapter found"
	detailNotAllowed = "Not allowed to use Bluetooth: check BlueZ's D-Bus policy (/etc/dbus-1/system.d/bluetooth.conf) or your user's groups"
)

// busErrorDetail turns a failed GetManagedObjects on org.bluez into words for the UI.
// The usual Linux problems each have their own D-Bus error: bluetoothd not running
// (nobody owns org.bluez), the policy refusing this user, or no bus at all (a container,
// a session without a system bus).
func busErrorDetail(err error) string {
	var de dbus.Error
	if errors.As(err, &de) {
		switch de.Name {
		case "org.freedesktop.DBus.Error.ServiceUnknown", "org.freedesktop.DBus.Error.NameHasNoOwner":
			return detailNoBlueZ
		case "org.freedesktop.DBus.Error.AccessDenied", "org.bluez.Error.NotPermitted",
			"org.freedesktop.PolicyKit1.Error.NotAuthorized":
			return detailNotAllowed
		case "org.freedesktop.DBus.Error.UnknownObject":
			return detailNoAdapter
		}
		// bluetoothd not running but installed: the bus tries to start it on demand
		// (D-Bus activation, through systemd on most distributions) and that fails.
		if strings.HasPrefix(de.Name, "org.freedesktop.DBus.Error.Spawn.") || strings.HasPrefix(de.Name, "org.freedesktop.systemd1.") {
			return detailNoBlueZ
		}
		return "Bluetooth is unavailable: " + de.Name
	}
	var pe *dbus.Error
	if errors.As(err, &pe) && pe != nil {
		return busErrorDetail(*pe)
	}
	return detailNoBus
}

// devicePath is where BlueZ keeps the device with MAC address addr under adapterPath.
func devicePath(adapterPath dbus.ObjectPath, addr string) dbus.ObjectPath {
	return dbus.ObjectPath(string(adapterPath) + "/dev_" + strings.ReplaceAll(strings.ToUpper(addr), ":", "_"))
}

// heldPedals lists the possible pedals connected to this computer now, by anyone: devices
// under adapterPath with Connected set that offer the switch service or BLE-MIDI (BlueZ
// fills UUIDs from the advertisement and, once connected, from discovery), whatever their
// name, with their UUIDs. The Manager decides which are pedals (classify). The address is
// spelled as tinygo spells a scan result's.
func heldPedals(objs bluezObjects, adapterPath dbus.ObjectPath) []Device {
	want := map[string]bool{strings.ToLower(sparkx.SwitchService): true, strings.ToLower(midiService): true}
	var out []Device
	for path, ifaces := range objs {
		props, ok := ifaces[bluezDevice]
		if !ok || !strings.HasPrefix(string(path), string(adapterPath)+"/") {
			continue
		}
		if c, _ := props["Connected"].Value().(bool); !c {
			continue
		}
		uuids, _ := props["UUIDs"].Value().([]string)
		offers := false
		services := make([]string, 0, len(uuids))
		for _, u := range uuids {
			offers = offers || want[strings.ToLower(u)]
			services = append(services, strings.ToLower(u))
		}
		if !offers {
			continue
		}
		name, _ := props["Name"].Value().(string)
		if name == "" {
			name, _ = props["Alias"].Value().(string)
		}
		addr, _ := props["Address"].Value().(string)
		if addr == "" {
			continue
		}
		out = append(out, Device{Name: name, Address: strings.ToUpper(addr), System: true, services: services})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Address < out[j].Address })
	return out
}

// deviceGone reports whether sig says the device at path is no longer connected: its
// Connected property turned false, or BlueZ removed the device object altogether.
func deviceGone(sig *dbus.Signal, path dbus.ObjectPath) bool {
	if sig == nil {
		return false
	}
	switch sig.Name {
	case dbusProperties + ".PropertiesChanged":
		if sig.Path != path || len(sig.Body) < 2 {
			return false
		}
		if iface, _ := sig.Body[0].(string); iface != bluezDevice {
			return false
		}
		changed, _ := sig.Body[1].(map[string]dbus.Variant)
		v, ok := changed["Connected"]
		if !ok {
			return false
		}
		c, ok := v.Value().(bool)
		return ok && !c
	case "org.freedesktop.DBus.ObjectManager.InterfacesRemoved":
		if len(sig.Body) < 2 {
			return false
		}
		p, _ := sig.Body[0].(dbus.ObjectPath)
		ifaces, _ := sig.Body[1].([]string)
		if p != path {
			return false
		}
		for _, i := range ifaces {
			if i == bluezDevice {
				return true
			}
		}
	}
	return false
}
