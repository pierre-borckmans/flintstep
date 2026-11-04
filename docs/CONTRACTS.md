# Package contracts

The app is built by several people at once. This file is the agreement between the
packages: names, signatures and behaviour. Change it only together with every user.

Spec: the "Spark Control X MIDI bridge" design doc (summarised in README.md).
Go module: `sparkbridge` (go.mod at repo root). Wails v2 app in package `main` at the root,
frontend in `frontend/`. Same stack as the Beam app (`../beam/app`): Wails v2.17,
React 19 + TS + Tailwind v4, bun 1.3.14, Biome, vitest, golangci-lint v2.

## Names

- App / product: **SparkX MIDI** (bundle id `com.silversol.sparkxmidi`)
- Virtual MIDI source: **Spark Control X**
- Virtual MIDI destination (LED feedback): **Spark Control X LEDs**
- Data dir: `~/Library/Application Support/SparkX MIDI/` (config.json, app.log, ble-trace.log)

## internal/sparkx (done, pure)

The pedal protocol, lifted from Beam. `Edge{Switch int; Down bool}`, `Edges(prev, cur byte)`,
`ParseMsg`, `Msg`/`Msg*` kinds, the info requests, `LampMessages`, `LampSet`, `Colour{R,G,B}`,
`ExpScale`, `Status`, `NewStatus()`, `NoBattery`, `Switches`=6, `SwitchNames`,
`Lamps`=8, `LampAmp`=6, `LampApp`=7, `ExpInputs`=2, GATT UUID constants, `IsName`.
Never add a builder for command types 03/07/0a/0e/13.

## internal/mapping (pure)

Config types (JSON is what the frontend edits, keep tags camelCase):

```go
type ActionKind string // "off" | "cc" | "note" | "pc"
type CCMode string     // "momentary" | "toggle"

type Action struct {
    Kind    ActionKind `json:"kind"`
    Channel int        `json:"channel"` // 1..16
    Number  int        `json:"number"`  // CC number, note number or program 0..127
    Value   int        `json:"value"`   // CC "on" value / note velocity, 1..127 (default 127)
    Mode    CCMode     `json:"mode"`    // cc only
}

type SwitchConfig struct {
    Tap    Action        `json:"tap"`
    Long   Action        `json:"long"`   // Kind "off" = no long press
    Colour sparkx.Colour `json:"colour"` // the lamp colour when lit
}

type Combo struct {
    A, B   int    `json:"a"`/`json:"b"` // switch indexes 0..5, A != B
    Action Action `json:"action"`
}

type ExpConfig struct {
    Enabled bool `json:"enabled"`
    Channel int  `json:"channel"`
    CC      int  `json:"cc"`
    Min     int  `json:"min"` // raw calibration 0..65535, Min < Max
    Max     int  `json:"max"`
    Invert  bool `json:"invert"`
}

type LEDMode string // "local" | "feedback"

type Config struct {
    Version     int                 `json:"version"`
    Pedal       PedalRef            `json:"pedal"` // remembered pedal; zero = none
    Switches    [6]SwitchConfig     `json:"switches"`
    Combos      []Combo             `json:"combos"`
    Exp         [2]ExpConfig        `json:"exp"`
    LEDMode     LEDMode             `json:"ledMode"`
    LongPressMS int                 `json:"longPressMs"` // default 500
    Brightness  int                 `json:"brightness"`  // 0..100 lamp dimming, default 100
}
type PedalRef struct { Address string `json:"address"`; Name string `json:"name"` }

func Default() Config        // the spec's table: switch n = CC 80+n momentary ch1, exp1 CC11, exp2 CC7, local LEDs
func (c Config) Normalize() Config // clamps everything into range, fills zero values with defaults
func (c Config) Validate() error   // human-readable error for the UI (e.g. "combo uses the same switch twice")
```

Engine (not safe for concurrent use; the bridge serialises calls):

```go
func NewEngine(cfg Config) *Engine
func (e *Engine) SetConfig(cfg Config)              // keeps toggle states where the switch is still a toggle
func (e *Engine) Switch(ed sparkx.Edge, at time.Time) [][]byte // MIDI to send now
func (e *Engine) Tick(at time.Time) [][]byte        // long-press / combo timers; called every ~10ms while anything is pending
func (e *Engine) Pending() bool                     // whether Tick has work
func (e *Engine) Exp(n, raw int) ([]byte, bool)     // calibrated + inverted + hysteresis -> CC; false = nothing to send
func (e *Engine) Feedback(msg []byte) bool          // MIDI from the LED destination; true if Lamps() changed
func (e *Engine) Lamps() [6]sparkx.Colour           // what the six switch lamps should show now (brightness applied)
func (e *Engine) Reset()                            // pedal disconnected: forget held/pending, keep toggles
```

Behaviour:
- Momentary CC: Value on press, 0 on release. Toggle CC: alternates Value/0 on each press, nothing on release.
- Note: note on (velocity Value) on press, note off on release. PC: program change on press.
- A switch with a Long action: nothing on press; release before LongPressMS fires Tap
  (press+release pair for momentary/note, i.e. on then off immediately); held to LongPressMS
  fires Long's press-half then, and Long's release-half on release.
- A switch that is part of any Combo waits 60 ms (comboWindow) before acting. If its partner
  goes down inside the window, the combo action fires instead (press-half now, release-half
  when the first of the two is released) and neither switch's own action fires.
- Local LED mode: a switch is lit (its Colour) while held, and while its toggle is on.
  Feedback mode: a switch is lit when the last CC/note received on its Tap's channel+number
  was non-zero (CC value > 0, note on velocity > 0); PC switches never light from feedback.
- Exp: raw outside a cable is never passed. Calibrated to Min..Max, inverted if asked,
  scaled to 0..127 with the same hysteresis idea as sparkx.ExpScale.

## internal/store

```go
func Dir() (string, error)                 // the data dir, created
func Load(path string) (mapping.Config, error) // missing file -> Default(), no error; corrupt -> Default() + error
func Save(path string, c mapping.Config) error // atomic (temp + rename)
```

## internal/ble (macOS CoreBluetooth via tinygo.org/x/bluetooth v0.16 + cbgo)

```go
type State string // "off" (bluetooth off/unauthorised) | "idle" | "searching" | "connecting" | "connected"

type Device struct { Name, Address string; RSSI int; System bool } // System: macOS already holds it

type Status struct {
    State    State         `json:"state"`
    Detail   string        `json:"detail"` // human words for the state, e.g. "Bluetooth is off"
    Name     string        `json:"name"`
    Address  string        `json:"address"`
    sparkx.Status                          // embedded: firmware, profile, battery, cables, held, lamps...
    ExpRaw   [2]int        `json:"expRaw"` // last raw value per input, -1 = none
}

type Handlers struct {
    Switch func(sparkx.Edge)       // each edge, in order, off the BLE thread
    Exp    func(n, raw int)        // raw expression value, only for inputs with a cable, ~60/s
    Status func(Status)            // whenever it changes, at most every 50 ms
}

func NewManager(h Handlers) *Manager
func (m *Manager) Start(target mapping.PedalRef) // keeps the pedal connected: reconnects forever with backoff (1s..15s); empty target = first SparkX found
func (m *Manager) SetTarget(target mapping.PedalRef) // reconnects to the new pedal
func (m *Manager) Stop()                         // lamps dark, disconnect, stop reconnecting
func (m *Manager) Scan(timeout time.Duration) ([]Device, error) // Spark Control X pedals in range or held by macOS
func (m *Manager) SetLamps(l [6]sparkx.Colour)   // only changed lamps are written
func (m *Manager) Status() Status
func (m *Manager) OnConnected(fn func(Device))   // called after each successful connect (bridge saves the remembered pedal)
```

Finding a pedal: remembered address by identifier -> a SparkX the Mac already holds
(retrieveConnectedPeripheralsWithServices on the switch service 7BDB8DC0... or the BLE-MIDI
service) -> scan for a name starting "SparkX". Amp and App lamps (6, 7) are lit by the
manager while connected. Writes on FFC9 go through one writer goroutine. Trace every RX/TX
except the exp stream to ble-trace.log (rotlog, 4 MB) when a trace path is set.

## internal/coremidi (cgo, darwin; stub elsewhere returning ErrUnsupported)

```go
var ErrUnsupported = errors.New("coremidi: not available on this platform")
type Virtual struct{ ... }
func NewVirtual(client, source, dest string, onDest func(msg []byte)) (*Virtual, error)
func (v *Virtual) Send(msg []byte) error // one complete MIDI message, MIDIReceived on the source
func (v *Virtual) Close()
```
onDest receives complete messages (parse running status, drop sysex/realtime) on a goroutine.
The source keeps a stable kMIDIPropertyUniqueID across launches (persist one derived from a
hash of the name), so DAW mappings survive a restart.

## internal/tray (cgo, darwin; no-op stub elsewhere)

```go
type Item struct { ID, Title string; Disabled, Separator, Checked bool }
func Start(templateIconPNG []byte, onClick func(id string)) // call once NSApp exists (Wails OnStartup); dispatches to main queue
func SetMenu(items []Item)
func SetTooltip(s string)
```
The bridge decides the items (status line, battery, "Open SparkX MIDI…", "Launch at login", "Quit").

## internal/loginitem

```go
func Enabled() bool
func Set(on bool) error // ~/Library/LaunchAgents/com.silversol.sparkxmidi.plist, runs the current executable with --hidden
```

## internal/bridge (pure glue, tested with fakes)

Owns one Engine, feeds it from ble.Handlers, sends to the virtual source, pipes the LED
destination back, drives Manager.SetLamps, emits UI events. Interfaces so it is testable:

```go
type Pedal interface { Start(mapping.PedalRef); SetTarget(mapping.PedalRef); Stop(); SetLamps([6]sparkx.Colour); Status() ble.Status }
type MIDIOut interface { Send([]byte) error }
type Activity struct { Dir string `json:"dir"`; Bytes []int `json:"bytes"`; Label string `json:"label"`; At int64 `json:"at"` } // "out" | "in"
```

## Wails bindings (package main, `App`), what the frontend calls

```ts
GetState(): Promise<State>
SaveConfig(cfg: Config): Promise<void>      // validates, persists, applies live
ResetConfig(): Promise<Config>
Scan(): Promise<Device[]>                   // ~4 s
ChoosePedal(address: string, name: string): Promise<void>
ForgetPedal(): Promise<void>
CalibrateExp(n: number, edge: "min" | "max"): Promise<Config> // stores the input's current raw value
SetLaunchAtLogin(on: boolean): Promise<void>
RevealLogs(): Promise<void>
```

```ts
type State = {
  pedal: Status            // ble.Status JSON
  config: Config           // mapping.Config JSON
  midi: { source: string; dest: string; ok: boolean; error: string }
  launchAtLogin: boolean
  version: string
}
```

Events (Wails `EventsOn`): `"state"` -> State (throttled ~20/s), `"activity"` -> Activity.
