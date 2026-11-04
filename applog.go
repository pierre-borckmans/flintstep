package main

import (
	"io"
	"log"
	"os"

	"sparkbridge/internal/rotlog"
)

// appLogMax is app.log's size cap before it rotates to app.log.1.
const appLogMax = 2 << 20

// startLog sends the standard logger to the terminal and to a capped file in the data
// dir, with millisecond timestamps so log lines line up with the BLE trace. If the file
// will not open, logging carries on to the terminal alone.
func startLog(path string) {
	log.SetFlags(log.Ldate | log.Ltime | log.Lmicroseconds)
	f, err := rotlog.Open(path, appLogMax)
	if err != nil {
		log.Printf("app log off, cannot open %s: %v", path, err)
		return
	}
	log.SetOutput(io.MultiWriter(os.Stderr, f))
	log.Printf("---- SparkX MIDI %s starting (pid %d) ----", version, os.Getpid())
}
