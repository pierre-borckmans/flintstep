//go:build darwin || linux

package ble

import (
	"errors"
	"fmt"
	"log"
	"strings"
	"sync"

	"tinygo.org/x/bluetooth"

	"flintstep/internal/sparkx"
)

// THE PEDAL'S GATT SIDE, shared by every radio built on tinygo-bluetooth (CoreBluetooth
// on macOS, BlueZ on Linux). tinygo gives both the same Device / DeviceService /
// DeviceCharacteristic API, so service discovery, the subscriptions and the FFC9 writes
// live here once. What differs per OS (finding pedals, connecting, noticing a drop) stays
// in radio_<os>.go.

// batteryService and batteryLevelChar are the standard GATT Battery Service.
const (
	batteryService   uint16 = 0x180F
	batteryLevelChar uint16 = 0x2A19
)

// powerService and powerChar push the USB power state: 01 on USB, 00 on battery
// (docs/PROTOCOL-NOTES.md). Read + notify.
const (
	powerService = "6FACFE71-A4C3-4E80-BA5C-533928830727"
	powerChar    = "90D9A098-9CD8-4A7A-B176-91FFE80909F2"
)

// pedalGATT is one connected pedal's services, as the session uses them: notifications
// to the sink, writes on FFC9. It remembers every characteristic it subscribed to, so a
// radio that has to undo them on hang-up can (radio_linux.go's unsubscribe: BlueZ keeps
// a D-Bus match and a goroutine per subscription); CoreBluetooth drops them with the
// link and never asks.
type pedalGATT struct {
	s  sink
	tx bluetooth.DeviceCharacteristic

	mu     sync.Mutex
	subs   []*bluetooth.DeviceCharacteristic
	closed bool
}

// setup discovers the pedal's services and subscribes. From the BEAM Mini app's sparkx_ble.go.
func (g *pedalGATT) setup(dev bluetooth.Device) error {
	swSvc, err := bluetooth.ParseUUID(sparkx.SwitchService)
	if err != nil {
		return err
	}
	swChar, err := bluetooth.ParseUUID(sparkx.SwitchChar)
	if err != nil {
		return err
	}
	cmdSvc := bluetooth.New16BitUUID(sparkx.CommandSvc)
	pwrSvc, err := bluetooth.ParseUUID(powerService)
	if err != nil {
		return err
	}
	// The switch and the command service are required: a device without both is not a
	// pedal this app can drive (an AirTurn page turner has the switch service alone),
	// and findServices says so with errIncompatible.
	//
	// One discovery for everything: tinygo clears its cache on each, so a second one
	// later could cost the first its notifications. tinygo also fails the whole call
	// when any asked-for service is missing, so findServices falls back to asking for
	// every service and picking ours out: the battery and power services are optional.
	svcs, opt, err := findServices(
		[]bluetooth.UUID{swSvc, cmdSvc},
		[]bluetooth.UUID{bluetooth.New16BitUUID(batteryService), pwrSvc},
		dev.DiscoverServices,
		bluetooth.DeviceService.UUID)
	if err != nil {
		return fmt.Errorf("discover the pedal's services: %w", err)
	}
	battSvc, powerSvc := opt[0], opt[1]
	sw, err := svcs[0].DiscoverCharacteristics([]bluetooth.UUID{swChar})
	if err != nil || len(sw) == 0 {
		return fmt.Errorf("discover the switch characteristic: %w", err)
	}
	cmd, err := svcs[1].DiscoverCharacteristics([]bluetooth.UUID{
		bluetooth.New16BitUUID(sparkx.CommandTx), bluetooth.New16BitUUID(sparkx.CommandRx)})
	if err != nil || len(cmd) < 2 {
		return fmt.Errorf("discover the command characteristics: %w", err)
	}
	g.tx = cmd[0]
	if err := g.notify(&sw[0], g.s.switches); err != nil {
		return fmt.Errorf("enable switch notifications: %w", err)
	}
	if err := g.notify(&cmd[1], g.s.command); err != nil {
		return fmt.Errorf("enable command notifications: %w", err)
	}
	// The optional characteristics one after the other: tinygo's characteristic
	// discovery shares one channel per device, so two at once could swap answers.
	go func() {
		if battSvc != nil {
			g.watchBattery(*battSvc)
		}
		if powerSvc != nil {
			g.watchPower(*powerSvc)
		}
	}()
	return nil
}

// notify subscribes to ch and remembers it. After unsubscribe it does nothing: the
// optional watchers run on their own goroutine and may finish after a hang-up.
func (g *pedalGATT) notify(ch *bluetooth.DeviceCharacteristic, f func([]byte)) error {
	g.mu.Lock()
	defer g.mu.Unlock()
	if g.closed {
		return errClosedLink
	}
	if err := ch.EnableNotifications(f); err != nil {
		return err
	}
	g.subs = append(g.subs, ch)
	return nil
}

var errClosedLink = errors.New("link closed")

// watchPower reads the USB power characteristic once and subscribes to its changes
// (~1 s after the cable goes in or out). Any failure only means no reading from it: the
// 0x11 request on FFC9 covers that.
func (g *pedalGATT) watchPower(svc bluetooth.DeviceService) {
	id, err := bluetooth.ParseUUID(powerChar)
	if err != nil {
		return
	}
	chars, err := svc.DiscoverCharacteristics([]bluetooth.UUID{id})
	if err != nil || len(chars) == 0 {
		log.Printf("ble: power service without its characteristic: %v", err)
		return
	}
	ch := chars[0]
	buf := make([]byte, 8)
	if n, err := ch.Read(buf); err != nil {
		log.Printf("ble: power read failed: %v", err)
	} else if on, ok := usbPower(buf[:n]); ok {
		g.s.power(on)
	}
	err = g.notify(&ch, func(v []byte) {
		if on, ok := usbPower(v); ok {
			g.s.power(on)
		}
	})
	if err != nil {
		log.Printf("ble: power notifications unavailable: %v", err)
	}
}

// watchBattery reads the Battery Level once and subscribes to its changes. Any failure
// only means no reading from it: the FFCA battery poll covers that.
func (g *pedalGATT) watchBattery(svc bluetooth.DeviceService) {
	chars, err := svc.DiscoverCharacteristics([]bluetooth.UUID{bluetooth.New16BitUUID(batteryLevelChar)})
	if err != nil || len(chars) == 0 {
		log.Printf("ble: battery service without a level: %v", err)
		return
	}
	ch := chars[0]
	buf := make([]byte, 8)
	if n, err := ch.Read(buf); err != nil {
		log.Printf("ble: battery read failed: %v", err)
	} else if level, ok := batteryLevel(buf[:n]); ok {
		g.s.battery(level)
	}
	err = g.notify(&ch, func(v []byte) {
		if level, ok := batteryLevel(v); ok {
			g.s.battery(level)
		}
	})
	if err != nil {
		log.Printf("ble: battery notifications unavailable: %v", err)
	}
}

// uuidStrings spells advertised service UUIDs as Device.services keeps them: 128-bit,
// lower case.
func uuidStrings(us []bluetooth.UUID) []string {
	out := make([]string, 0, len(us))
	for _, u := range us {
		out = append(out, strings.ToLower(u.String()))
	}
	return out
}

// write sends one message on FFC9, with response.
func (g *pedalGATT) write(b []byte) error {
	_, err := g.tx.Write(b)
	return err
}
