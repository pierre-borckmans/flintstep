// Command fakebluez stands in for bluetoothd on the system bus in the Linux smoke test
// (scripts/linux/smoke.sh), where the kernel has no Bluetooth and the real daemon exits
// at once. It owns org.bluez and answers ObjectManager.GetManagedObjects, which is all
// the radio asks before deciding whether Bluetooth can be used:
//
//	fakebluez none   BlueZ is running but has no adapter
//	fakebluez off    one adapter, hci0, powered off
//
// It runs until killed. Not part of the app.
package main

import (
	"fmt"
	"os"

	"github.com/godbus/dbus/v5"
)

type objects = map[dbus.ObjectPath]map[string]map[string]dbus.Variant

type manager struct{ objs objects }

func (m manager) GetManagedObjects() (objects, *dbus.Error) { return m.objs, nil }

func main() {
	mode := "none"
	if len(os.Args) > 1 {
		mode = os.Args[1]
	}
	objs := objects{}
	switch mode {
	case "none":
	case "off":
		objs["/org/bluez/hci0"] = map[string]map[string]dbus.Variant{"org.bluez.Adapter1": {
			"Address":    dbus.MakeVariant("00:00:00:00:00:00"),
			"Powered":    dbus.MakeVariant(false),
			"PowerState": dbus.MakeVariant("off"),
		}}
	default:
		fmt.Fprintf(os.Stderr, "usage: fakebluez none|off\n")
		os.Exit(2)
	}
	conn, err := dbus.ConnectSystemBus()
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	if err := conn.Export(manager{objs}, "/", "org.freedesktop.DBus.ObjectManager"); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	reply, err := conn.RequestName("org.bluez", dbus.NameFlagDoNotQueue)
	if err != nil || reply != dbus.RequestNameReplyPrimaryOwner {
		fmt.Fprintf(os.Stderr, "cannot own org.bluez: %v (%v)\n", err, reply)
		os.Exit(1)
	}
	fmt.Printf("fakebluez: owning org.bluez, mode %s\n", mode)
	select {}
}
