// sparkx-midi is the bridge without the app: connect to a Spark Control X, publish the
// virtual MIDI source, print every switch and every message. Milestone 1 of the design
// doc, and still the quickest way to check a pedal against MIDI Monitor or Logic.
//
//	go run ./cmd/sparkx-midi            # first SparkX found, the app's saved mapping
//	go run ./cmd/sparkx-midi -scan      # list pedals and exit
//	go run ./cmd/sparkx-midi -addr <id> # a specific pedal
//
// It reads the app's active preset (or the defaults) but never writes anything.
package main

import (
	"flag"
	"fmt"
	"log"
	"os"
	"os/signal"
	"syscall"
	"time"

	"sparkbridge/internal/ble"
	"sparkbridge/internal/bridge"
	"sparkbridge/internal/coremidi"
	"sparkbridge/internal/mapping"
	"sparkbridge/internal/presets"
	"sparkbridge/internal/sparkx"
	"sparkbridge/internal/store"
)

func main() {
	scan := flag.Bool("scan", false, "list Spark Control X pedals and exit")
	addr := flag.String("addr", "", "connect to this pedal (CoreBluetooth identifier)")
	defaults := flag.Bool("defaults", false, "ignore the saved mapping, use the defaults")
	trace := flag.String("trace", "", "write the BLE wire trace to this file")
	flag.Parse()
	log.SetFlags(log.Ltime | log.Lmicroseconds)

	cfg := mapping.Default()
	if !*defaults {
		if dir, err := store.Dir(); err == nil {
			c, err := presets.ReadActive(dir)
			if err != nil {
				log.Printf("config: %v (using defaults)", err)
			}
			cfg = c
		}
	}

	var st ble.Status
	b := bridge.New(cfg, nil, bridge.Options{
		OnActivity: func(a bridge.Activity) { fmt.Printf("  %-3s %s\n", a.Dir, a.Label) },
		OnStatus: func(s ble.Status) {
			if s.State != st.State {
				fmt.Printf("pedal: %s %s %s\n", s.State, s.Name, s.Detail)
			}
			if s.Battery != st.Battery && s.Battery >= 0 {
				fmt.Printf("pedal: battery %d%%\n", s.Battery)
			}
			if s.ProfileName != st.ProfileName && s.ProfileName != "" {
				fmt.Printf("pedal: firmware %s, profile %d %q\n", s.Firmware, s.Profile, s.ProfileName)
			}
			st = s
		},
	})
	defer b.Close()

	h := b.Handlers()
	sw := h.Switch
	h.Switch = func(e sparkx.Edge) {
		dir := "up"
		if e.Down {
			dir = "down"
		}
		fmt.Printf("switch %-3s %s\n", sparkx.SwitchNames[e.Switch], dir)
		sw(e)
	}
	m := ble.NewManager(h, *trace)
	b.SetPedal(m)

	if *scan {
		ds, err := m.Scan(5 * time.Second)
		if err != nil {
			log.Fatalf("scan: %v", err)
		}
		if len(ds) == 0 {
			fmt.Println("no Spark Control X found: is it on, and not connected to the Spark app?")
		}
		for _, d := range ds {
			held := ""
			if d.System {
				held = " (held by macOS)"
			}
			fmt.Printf("%s  %s  rssi %d%s\n", d.Address, d.Name, d.RSSI, held)
		}
		return
	}

	v, err := coremidi.NewVirtual("SparkX MIDI", "Spark Control X", "Spark Control X LEDs", b.Feedback)
	if err != nil {
		log.Fatalf("midi: %v", err)
	}
	defer v.Close()
	b.SetOut(v)
	fmt.Println(`midi: virtual source "Spark Control X" is up; open MIDI Monitor or your DAW`)

	tg := ble.Target{Address: cfg.Pedal.Address, Name: cfg.Pedal.Name}
	if *addr != "" {
		tg = ble.Target{Address: *addr}
	}
	m.Start(tg)

	sig := make(chan os.Signal, 1)
	signal.Notify(sig, os.Interrupt, syscall.SIGTERM)
	<-sig
	fmt.Println("\nstopping: lamps off, disconnecting")
	m.Stop()
}
