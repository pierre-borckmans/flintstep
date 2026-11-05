# Package contracts

The app is built by several people at once. This file is the agreement between the
packages: names, signatures and behaviour. Change it only together with every user.

Spec: the "Spark Control X MIDI bridge" design doc (summarised in README.md).
Go module: `sparkbridge` (go.mod at repo root). Wails v2 app in package `main` at the root,
frontend in `frontend/`. Same stack as the Beam app (`../beam/app`): Wails v2.17,
React 19 + TS + Tailwind v4, bun 1.3.14, Biome, vitest, golangci-lint v2.

## Names

`product.env` is the source for the build and release tooling (see docs/RELEASING.md,
"Renaming"); the Go and TS constants below must match it.

- App / product: **SparkX MIDI** (bundle id `com.silversol.sparkxmidi`)
- Virtual MIDI source: **Spark Control X**
- Virtual MIDI destination (LED feedback): **Spark Control X LEDs**
- Data dir: `~/Library/Application Support/SparkX MIDI/` (library.json, prefs.json, app.log, ble-trace.log;
  config.json from before presets is kept as a backup and no longer written)

## internal/sparkx (done, pure)

The pedal protocol, lifted from Beam. `Edge{Switch int; Down bool}`, `Edges(prev, cur byte)`,
`ParseMsg`, `Msg`/`Msg*` kinds, the info requests (`PowerRequest` is `11 00 00 00`, answered by
`MsgPower` with Value 1 on USB power, 0 on battery), `LampMessages`, `LampSet`, `Colour{R,G,B}`,
`ExpScale`, `Status` (with `Powered bool` json "powered"), `NewStatus()`, `NoBattery`, `Switches`=6, `SwitchNames`,
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
    Min     int  `json:"min"`    // raw value at the heel, 0..65535
    Max     int  `json:"max"`    // raw value at the toe; may be below Min, never equal to it
    Invert  bool `json:"invert"` // the user's own flip, on top of heel=0 toe=127
    Trigger ExpTrigger `json:"trigger"`
}

type TriggerMode string // "off" | "engage" | "toe"
type ExpTrigger struct {
    Mode       TriggerMode `json:"mode"`
    Action     Action      `json:"action"`     // press half on engaging, release half on letting go
    Threshold  int         `json:"threshold"`  // percent of the calibrated travel, 1..99
    OffDelayMS int         `json:"offDelayMs"` // engage only, 0..2000
}

type LEDMode string // "local" | "feedback"

type IndicatorMode string // "off" | "connected" | "midiOut" | "midiIn" | "usb" | "on"
type Indicator struct {
    Mode   IndicatorMode `json:"mode"`
    Colour sparkx.Colour `json:"colour"` // the colour when lit
}

type Config struct {
    Version     int                 `json:"version"`
    Pedal       PedalRef            `json:"pedal"` // remembered pedal; zero = none
    Switches    [6]SwitchConfig     `json:"switches"`
    Combos      []Combo             `json:"combos"`
    Exp         [2]ExpConfig        `json:"exp"`
    LEDMode     LEDMode             `json:"ledMode"`
    LongPressMS int                 `json:"longPressMs"` // 150..3000 (MinLongPressMS..MaxLongPressMS), default 500
    Brightness  int                 `json:"brightness"`  // 0..100 lamp dimming, default 100
    Indicators  [2]Indicator        `json:"indicators"`  // 0 = Amp lamp, 1 = App lamp
}
type PedalRef struct { Address string `json:"address"`; Name string `json:"name"` }

func Default() Config        // the spec's table: switch n = CC 80+n momentary ch1, exp1 CC11, exp2 CC7, local LEDs,
                             // Amp = midiOut green (00,B0,50), App = connected indigo (40,20,FF),
                             // exp n trigger off with CC 102+n momentary ch1 127, 4 %, 400 ms
func (c Config) Normalize() Config // clamps everything into range, fills zero values with defaults
func (c Config) Validate() error   // human-readable error for the UI (e.g. "combo I + I uses the same switch twice")
```

Engine (not safe for concurrent use; the bridge serialises calls):

```go
func NewEngine(cfg Config) *Engine
func (e *Engine) SetConfig(cfg Config) [][]byte     // keeps toggle states where the switch is still a toggle;
                                                    // returns the release of a trigger that must let go
func (e *Engine) Switch(ed sparkx.Edge, at time.Time) [][]byte // MIDI to send now
func (e *Engine) Tick(at time.Time) [][]byte        // long-press / combo / trigger off-delay timers; every ~10ms while pending
func (e *Engine) Pending() bool                     // whether Tick has work
func (e *Engine) Exp(n, raw int, at time.Time) [][]byte // calibrated + inverted + hysteresis -> CC, plus the
                                                    // trigger's press (before the CC) or release (after it)
func (e *Engine) ExpRelease(n int) [][]byte         // input n lost its cable: its trigger lets go, next value resent
func (e *Engine) ExpTriggers() [2]bool              // engaged now: held, or on for a CC toggle action
func (e *Engine) Feedback(msg []byte) bool          // MIDI from the LED destination; true if Lamps() changed
func (e *Engine) Lamps() [6]sparkx.Colour           // what the six switch lamps should show now (brightness applied)
func (e *Engine) Reset() [][]byte                   // pedal disconnected: forget held/pending, keep toggles;
                                                    // returns the release half of anything still sounding

type IndicatorState struct { Connected, Powered, Out, In bool } // Out/In: a flash is lit
func IndicatorLamps(cfg Config, st IndicatorState) [2]sparkx.Colour // Amp, App; brightness applied
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
- Exp: raw outside a cable is never passed. Min is always the heel and Max always the
  toe, in whatever order the numbers fall: a pedal whose toe reads lower than its heel
  just has Min > Max. Heel maps to 0 and toe to 127 either way; Invert is only the user's
  toggle, applied on top. Normalize never swaps Min and Max or touches Invert.
  Min == Max on an enabled input is a Validate error (0/0 is "not calibrated" and
  Normalize makes it 0..65535); the engine treats one-point calibration as the whole jack.
  Scaled to 0..127 with the same hysteresis idea as sparkx.ExpScale.
- Exp trigger (a toe switch faked from the position, since the jack reads one value):
  measured on the same calibrated, inverted travel as the CC, in percent. "engage":
  press on reaching Threshold (default 4), release once under Threshold - 3 for
  OffDelayMS (default 400; rising back to Threshold inside the delay cancels it).
  "toe": press on reaching Threshold (default 96), release under Threshold - 3. The
  fixed 3 % (TriggerHysteresis) stops chatter; where Threshold - 3 would be at or below
  the heel, the heel itself lets go. A CC toggle flips on each press and has no release.
  The release always ends what the press sent. Reset, ExpRelease, and a SetConfig that
  disables the input or changes the trigger's mode or action let go of a held trigger
  (a new threshold or delay is read on the next value); toggle states survive like
  switch toggles. Normalize: a trigger with no mode (files before version 3) becomes the
  default; unknown mode -> off; threshold 0 -> the mode's default, then 1..99; off delay
  0..2000 (0 is valid); action normalised like a switch's. Validate: an engage/toe
  trigger with an "off" action is "expression N: the trigger does nothing: pick what it sends".
- Long press: LongPressMS is clamped to MinLongPressMS..MaxLongPressMS (150..3000 ms); the
  frontend's slider and validate use the same range.
- Validate runs on a Normalized config. Its rules, in order: per combo, a switch that does
  not exist, the same switch twice, an "off" action, a pair already used; then an enabled
  expression input with Min == Max, then (same input) a trigger that does nothing. The frontend's validate() checks exactly these first,
  in the same words, then the ranges Normalize would otherwise clamp silently.
  The frontend's defaultConfig() equals Default() field for field (colours included).
- Indicators (the Amp and App lamps): "connected" is lit while the bridge holds the pedal,
  "midiOut" flashes on each message sent, "midiIn" on each message to the LED destination,
  "usb" is lit on USB power, "on" always, "off" never. Normalize turns an unknown mode into
  that lamp's default mode and a black colour into its default colour. ConfigVersion is 3:
  a version 1 file has no "indicators" and so gets the defaults; a version 2 file has no
  "trigger" on its inputs and so gets them off.

## internal/store

```go
func Dir() (string, error)                 // the data dir, created
func Load(path string) (mapping.Config, error) // missing file -> Default(), no error; corrupt -> Default() + error
func Save(path string, c mapping.Config) error // atomic (temp + rename)
func WriteAtomic(path string, b []byte) error  // the same, for any file

// prefs.json: how this Mac shows the app, never part of a preset.
type Theme string // "system" | "dark" | "light"
type Prefs struct { Theme Theme `json:"theme"` }
const PrefsFile = "prefs.json"
func ParseTheme(s string) (Theme, bool)
func DefaultPrefs() Prefs                // Theme "system"
func LoadPrefs(path string) Prefs        // missing, damaged or unknown -> defaults; never fails
func SavePrefs(path string, p Prefs) error // atomic
```

## internal/presets (pure, files only)

Named mappings in `library.json`. A preset is a name and one whole `mapping.Config`; the
package copies Configs whole and never names their fields (a field added to Config rides
along in presets, exports and imports). The remembered pedal is the exception: it is
global, stored once at the top of the library, zeroed in every stored preset and put back
on the active one.

```go
type Info struct { ID string `json:"id"`; Name string `json:"name"`; UpdatedAt int64 `json:"updatedAt"`; Active bool `json:"active"` } // unix ms

func Open(dir string) (*Library, error) // always returns a usable library; the error says what went wrong
func (l *Library) Active() mapping.Config    // the active preset's, with the global pedal
func (l *Library) ActiveID() string
func (l *Library) Has(id string) bool
func (l *Library) List() []Info              // library order
func (l *Library) Pedal() mapping.PedalRef
func (l *Library) SetPedal(p mapping.PedalRef) error
func (l *Library) SaveActive(c mapping.Config) error // c.Pedal ignored
func (l *Library) SaveInto(id string, c mapping.Config) error // active or not; c.Pedal ignored; unknown id → error
func (l *Library) Select(id string) (mapping.Config, error)
func (l *Library) Create(name, from string) (Info, error) // from "current" | "default"; "" name = "New preset", made unique
func (l *Library) Rename(id, name string) error
func (l *Library) Duplicate(id string) (Info, error)      // "<name> copy", made unique
func (l *Library) Delete(id string) error
func (l *Library) Export(id string) (data []byte, fileName string, err error)
func (l *Library) Import(data []byte, filename string) (Info, error)
```

File: `{ "version": 1, "active": id, "presets": [{ id, name, config, createdAt, updatedAt }],
"pedal": PedalRef }`, written whole and atomically on every change; memory only changes once
the write worked.

- Open: no library.json but a config.json → one preset "My mapping" from it, its pedal the
  global one, config.json left untouched. Neither → one default "My mapping". A library.json
  that does not parse is renamed `library.json.corrupt-<yyyymmdd-hhmmss>`, replaced by the
  default library, and reported. A parseable one is repaired: missing/duplicate ids get new
  ones, names are trimmed/cut/made unique ("Untitled" for none), configs normalized and
  stripped of a pedal, an empty list gets "My mapping", an unknown active falls back to the
  first preset.
- Names: trimmed, 1..40 characters (runes), unique ignoring case. A clash is an error for
  Create/Rename; Duplicate and Import add " (2)", " (3)"… (cutting the base to stay ≤ 40).
- Create, Duplicate and Import never activate. Delete refuses the last preset; deleting the
  active one activates the next preset, or the previous one if it was last.
- Export format: `{ "format": "sparkx-midi-preset", "version": 1, "name": ..., "config": {...} }`,
  the config without its "pedal" key, suggested file name `<name>.sparkx.json` (`/ : \` → `-`).
  Import takes that format (a newer version is refused) or a bare Config such as an old
  config.json (only Config's keys allowed, named after the file); the config is normalized,
  must Validate, and loses its pedal.

## internal/ble (macOS CoreBluetooth via tinygo.org/x/bluetooth v0.16 + cbgo)

```go
type State string // "off" (bluetooth off/unauthorised) | "idle" | "searching" | "connecting" | "connected"

type Device struct { Name, Address string; RSSI int; System bool } // System: macOS already holds it

type Status struct {
    State    State         `json:"state"`
    Detail   string        `json:"detail"` // human words for the state, e.g. "Bluetooth is off"
    Name     string        `json:"name"`
    Address  string        `json:"address"`
    sparkx.Status                          // embedded: firmware, profile, battery, powered, cables, held, lamps...
    ExpRaw   [2]int        `json:"expRaw"` // last raw value per input, -1 = none
}

type Handlers struct {
    Switch func(sparkx.Edge)       // each edge, in order, off the BLE thread
    Exp    func(n, raw int)        // raw expression value, only for inputs with a cable, ~60/s
    Status func(Status)            // whenever it changes, at most every 50 ms
}

type Target struct { Address, Name string } // mapping.PedalRef at the ble boundary (ble does not import mapping); empty Address = first SparkX found

func NewManager(h Handlers, tracePath string) *Manager // tracePath "" = no trace
func (m *Manager) Start(target Target)     // keeps the pedal connected: reconnects forever with backoff (1s..15s)
func (m *Manager) SetTarget(target Target) // lets go of a pedal that is not the new target and connects to it
func (m *Manager) Stop()                         // lamps dark, disconnect, stop reconnecting
func (m *Manager) Scan(timeout time.Duration) ([]Device, error) // Spark Control X pedals in range or held by macOS
func (m *Manager) SetLamps(l [8]sparkx.Colour)   // all eight: six switches, Amp (6), App (7); only changed lamps are written
func (m *Manager) Status() Status
func (m *Manager) OnConnected(fn func(Device))   // called after each successful connect to the target of the moment
                                                 // (app saves the remembered pedal); not called for a connect whose
                                                 // target was replaced by SetTarget while it was dialling
```

Finding a pedal: remembered address by identifier -> a SparkX the Mac already holds
(retrieveConnectedPeripheralsWithServices on the switch service 7BDB8DC0... or the BLE-MIDI
service) -> scan for a name starting "SparkX". All eight lamps are the caller's (the bridge
decides Amp and App too); the manager writes them on connect, rewrites them every 3 s, and
darkens them all on a hang-up. Writes on FFC9 go through one writer goroutine. On connect it
asks firmware, profile, battery, cables and power (0x11); battery and power again every 15 s.
USB power also comes from characteristic 90D9A098-… (service 6FACFE71-…), subscribed when
the pedal has it; Powered follows whichever spoke last. Trace every RX/TX
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
type Pedal interface { SetLamps([8]sparkx.Colour); Status() ble.Status } // the app owns Start/SetTarget/Stop
type MIDIOut interface { Send([]byte) error }
type Activity struct { Dir string `json:"dir"`; Bytes []int `json:"bytes"`; Label string `json:"label"`; At int64 `json:"at"` } // "out" | "in"
type Options struct { OnActivity func(Activity); OnStatus func(ble.Status); OnTrigger func([2]bool); OnSim func(); Now func() time.Time }
func (b *Bridge) ExpTriggers() [2]bool // Engine.ExpTriggers under the bridge's lock

// Simulated expression pedals (sim.go): test the whole exp path without one.
func (b *Bridge) SimulateExp(n int, on bool) error      // on at the heel; refused with a real cable in jack n
func (b *Bridge) SetSimExp(n int, fraction float64) error // 0 heel..1 toe -> raw FractionRaw(f); turns on, stops a sweep
func (b *Bridge) SimSweep(n int, on bool) error         // heel->toe->heel, cosine-eased, SweepPeriod (4 s), from where it is
func (b *Bridge) ExpSim() [2]bool                       // simulated now
func (b *Bridge) ExpSweep() [2]bool                     // sweeping now
func (b *Bridge) Status() ble.Status                    // Pedal.Status with simulated jacks: cables[n] true, expRaw[n] simulated
func FractionRaw(f float64) int                         // round(clamp(f) * 65535)
var ErrClosed error                                     // the sim calls after Close
```

OnTrigger is called (inside a step, like OnActivity) whenever ExpTriggers changes:
an engage, a let-go, an off delay ending on the tick loop. The bridge lets go of a
trigger on disconnect (Engine.Reset) and for each jack a connected Status reports
without a cable (Engine.ExpRelease), and sends what SetConfig returns from Apply.

Simulation: a simulated input's raw value goes to the engine through the same step as a
real pedal's (so its CCs and trigger reach the virtual port and the activity log), at
most every 16 ms (simEvery); a faster SetSimExp is held and the latest sent by the sim
loop, a goroutine that runs while any input is simulated and stops on Close. A real exp
value for a simulated jack is ignored; a connected Status with a real cable in it ends
the simulation (logged), lets go of its trigger, and real values flow. A cable-less
Status does not release a simulated jack. Turning it off lets go like a cable coming
out (Engine.ExpRelease) and forgets the reading. After Reset or Apply the current
simulated value is fed again, so a new calibration shows on a parked pedal. Works
with the pedal disconnected too. Never persisted: off at launch. OnSim is called (no
lock held) on every on/off/sweep change and each value fed.

## Wails bindings (package main, `App`), what the frontend calls

```ts
GetState(): Promise<State>
SaveConfig(cfg: Config): Promise<void>      // validates, persists, applies live (the active preset)
SaveConfigInto(id: string, cfg: Config): Promise<void> // validates, persists into preset id; applies
                                            // live only if id is active (checked under cfgMu, the
                                            // same lock as SelectPreset); unknown id → error
ResetConfig(): Promise<Config>
Scan(): Promise<Device[]>                   // ~4 s
ChoosePedal(address: string, name: string): Promise<void> // saves the pedal and calls SetTarget under one lock
ForgetPedal(): Promise<void>                               // same, with an empty target
CalibrateExp(n: number, edge: "min" | "max"): Promise<Config> // stores the input's current raw value as heel ("min")
                                                              // or toe ("max") as it is, never swapped; errors if heel == toe
                                                              // (a simulated input's raw counts)
SimulateExp(n: number, on: boolean): Promise<void>  // Bridge.SimulateExp; not saved
SetSimExp(n: number, fraction: number): Promise<void> // Bridge.SetSimExp
SimSweep(n: number, on: boolean): Promise<void>     // Bridge.SimSweep
SetLaunchAtLogin(on: boolean): Promise<void>
RevealLogs(): Promise<void>
SetTheme(mode: "system" | "dark" | "light"): Promise<void> // native window appearance + background,
                                                           // saved to prefs.json; errors on another mode

// Presets. SaveConfig, ResetConfig and CalibrateExp write into the active preset;
// SaveConfigInto into the one named. The pedal stays global in all of them.
ListPresets(): Promise<PresetInfo[]>
SelectPreset(id: string): Promise<Config>          // activates and runs it (pedal re-applied)
CreatePreset(name: string, from: "current" | "default"): Promise<PresetInfo> // not activated; "" = "New preset"
RenamePreset(id: string, name: string): Promise<void>
DuplicatePreset(id: string): Promise<PresetInfo>   // "<name> copy", not activated
DeletePreset(id: string): Promise<void>            // not the last; the active one → its neighbour runs
ExportPreset(id: string): Promise<void>            // native save panel; cancel resolves
ImportPreset(): Promise<PresetInfo>                // native open panel (*.json); cancel → id ""; not activated
```

The file panels sit behind `fileDialogs` (package main) so the bindings are tested without
Wails. The frontend activates a created or imported preset itself with SelectPreset, so the
switch is an undo step.

```ts
type State = {
  pedal: Status            // ble.Status JSON
  config: Config           // mapping.Config JSON
  midi: { source: string; dest: string; ok: boolean; error: string }
  launchAtLogin: boolean
  version: string
  presets: PresetInfo[]    // { id, name, updatedAt (unix ms), active }
  activePreset: string     // id
  libraryError: string     // what went wrong opening library.json, "" = nothing
  expTrigger: [boolean, boolean] // each input's trigger engaged now (Bridge.ExpTriggers)
  expSim: [boolean, boolean]     // each input simulated now (Bridge.ExpSim); pedal is Bridge.Status,
                                 // so a simulated jack shows cables[n] true and its expRaw[n]
  expSweep: [boolean, boolean]   // each simulated input sweeping (Bridge.ExpSweep)
}
```

Undo (frontend): one history of `{ preset, config }` entries. Edits are entries within the
active preset; selecting a preset is an entry labelled "Preset · <name>", and undoing or
jumping across it selects the other preset again (and saves the entry's mapping into it if
Go's differs). Create, rename, duplicate, delete, import and export are not undo steps;
deleting a preset drops its entries. A switch made from the menu bar becomes an entry too.

Menu bar: with two or more presets, they are listed flat under a separator (the tray has no
submenus), the active one checked; clicking one selects it.

Theme: the frontend keeps the choice in localStorage (`sparkx.theme`), sets
`<html data-theme>` ("light" / "dark", absent for system, where CSS follows
`prefers-color-scheme`), and calls SetTheme on load and on every change. Go keeps its own
copy in prefs.json so main.go opens the window in the right appearance and background
before the webview loads. On darwin SetTheme sets `NSApp.appearance` (nil for system) and
gives the Wails window a dynamic background that follows the effective appearance.

The bridge computes the Amp and App lamps with mapping.IndicatorLamps from the config, the
pedal's status (connected, powered) and two flash timers: a MIDI flash stays lit 120 ms after
the last message (each message extends it), timed on the bridge's injected clock and ended by
its tick loop, so a burst is two lamp updates (on, off), diffed like every lamp.

Events (Wails `EventsOn`): `"state"` -> State (throttled ~20/s), `"activity"` -> Activity.
