# Porting Flintstep

Flintstep started as a macOS app. Everything that touches the OS sits behind a small
number of seams, and porting means filling them in for one more OS. This file lists the
seams, says what the Linux port did and how far it was checked, and lays out a plan for
Windows.

Status in November 2026:

| OS | State |
| --- | --- |
| macOS 12+ | The reference. Used daily with a real pedal. |
| Linux | Experimental. Builds, packages, starts and passes its tests in Docker. **Never run against a real pedal.** |
| Windows | Builds with stubs (no Bluetooth, no MIDI, no tray). Plan below; no code yet. |

## The seams

`internal/platform` (package doc) is the authoritative list, and its test fails to compile
on any GOOS where a seam has gone missing or changed shape. In short:

| Seam | Where | macOS | Linux | Windows today |
| --- | --- | --- | --- | --- |
| Radio | `internal/ble/radio_<os>.go`, interface `radio` in `radio.go` | CoreBluetooth via tinygo + cbgo | BlueZ via tinygo + godbus | stub: "unsupported" |
| Virtual MIDI | `internal/coremidi/coremidi_<os>.go` | CoreMIDI (cgo) | ALSA sequencer (cgo) | `ErrUnsupported` |
| Tray | `internal/tray/tray_<os>.go` | NSStatusItem (cgo) | StatusNotifierItem (fyne.io/systray, D-Bus) | no-op, `Available` false |
| Login item | `internal/loginitem` | LaunchAgent plist | XDG autostart `.desktop` | LaunchAgent code (wrong, harmless) |
| Theme | `theme_<os>.go` in package main | NSAppearance | GTK prefer-dark, desktop portal | no-op |
| Activation | `activate_<os>.go` | `activateIgnoringOtherApps` | no-op (Wails presents the window) | no-op |
| Window policy | `platform_<os>.go` | hide on close, `--hidden` starts hidden | hide on close only with a tray host; single instance | close quits |

Only the radio is a Go interface, because the Manager's connect path, reconnect loop
and pedal session are tested against a fake of it (`internal/ble/fake_test.go`). The
others are package-level functions with fixed signatures. The pure logic around each
seam (BlueZ answers, autostart entries, menu diffs, MIDI byte parsing, portal values)
lives in files without build tags or with a plain `linux` tag, so it is unit-tested
without the OS underneath.

Rules every port keeps, also in the package doc:

- Radio callbacks may run on OS threads and must not block. An address is whatever the
  OS identifies a peripheral by, opaque to the rest of the app. The remembered pedal is
  therefore per OS, and the name fallback in `find.go` finds it again after a move.
- `Virtual.Send` takes one complete message and is safe from any goroutine; LED feedback
  reaches `onDest` as complete channel messages, through `coremidi`'s parser, on one
  goroutine; `Close` waits for the last call.
- The tray never takes the main thread (Wails owns it). `Available` says whether the
  desktop will show the item; without one, closing the window has to quit.
- The login item starts the current executable with `--hidden`, and its file format has
  a pure `Render` with a golden test.

## What the Linux port did

**Bluetooth** (`internal/ble/radio_linux.go`, `bluez.go`). tinygo-bluetooth's BlueZ
backend does scanning, connecting, discovery, notifications and writes (FFC9 with
response, `type: request`). The GATT code moved out of the macOS radio into
`gatt_tinygo.go`, shared by both. Three things tinygo does not do on Linux, the radio
does itself over a private system-bus connection:

- Power and errors: it picks the adapter (hci0, else the first powered), reads `Powered`
  and `PowerState`, and turns D-Bus failures into instructions: bluetoothd not running
  (including failed D-Bus activation, found by the smoke test), no adapter, rfkill,
  access denied.
- Pedals BlueZ already holds: `Device1` objects with `Connected=true` offering the switch
  service or BLE-MIDI. A pedal connected before Flintstep dialled is left connected when
  Flintstep lets go, matching macOS, where hanging up only drops the app's claim.
- Drops: tinygo only reports its own Connect/Disconnect, so each connection watches its
  device's `Connected` property (and `InterfacesRemoved`) and tells the session. On hang-up
  it also ends the notification subscriptions, which tinygo otherwise keeps running.

BlueZ can only connect a device it knows (seen in a scan since bluetoothd started, or
paired). The first connect attempt by address then fails at once and `find.go` scans,
which is the existing fallback.

**Virtual MIDI** (`internal/coremidi/coremidi_linux.go`). One ALSA sequencer client, two
simple ports with the macOS names. Output is `snd_seq_event_output_direct` to
subscribers; a reader goroutine polls the client (and a wake-up pipe for `Close`), decodes
events back to bytes with `snd_midi_event_decode` and feeds the existing parser. PipeWire's
and JACK's ALSA MIDI bridges show the ports to their clients. libasound is LGPL-2.1 and
linked dynamically from the system, so it is not part of the Go licence notices.

**Tray** (`internal/tray/tray_linux.go`). fyne.io/systray v1.12.2 (Apache-2.0,
maintained by the Fyne project, last release June 2026). On Linux it is pure D-Bus: no GTK,
no main thread, no event loop, so `RunWithExternalLoop` returns immediately and sits beside
Wails' GTK loop. That was the deciding question, and reading its Linux code answered it:
the exported StatusNotifierItem and dbusmenu objects are served from godbus goroutines.
The bridge sends the whole menu up to 20 times a second, so `planMenu` turns that into
nothing, an in-place title update, or a rebuild. Stock GNOME has no tray host; `Available`
detects that (no `org.kde.StatusNotifierWatcher` on the session bus) and the window's close
button then quits.

**Login item**: `~/.config/autostart/flintstep.desktop`, running `$APPIMAGE` when started
from an AppImage (the executable inside lives in a mount that changes every run).

**Theme**: the desktop portal's `org.freedesktop.appearance color-scheme`, followed live,
sets GTK's `gtk-application-prefer-dark-theme`, which WebKitGTK also uses for
`prefers-color-scheme`. Fallback: `GTK_THEME`.

**Packaging** (`build/linux`, `scripts/linux`, `make linux`). Ubuntu 22.04 image, so glibc
2.35 and WebKitGTK 4.1 (`webkit2_41` tag); amd64 and arm64. AppImage via appimagetool 1.9.1
with a pinned type-2 runtime, and a .deb via nfpm. Neither bundles GTK or WebKit:
WebKitGTK's helper processes live at fixed paths and do not survive relocation without
patching, so the AppImage relies on the system's `libwebkit2gtk-4.1-0`.

### How it was checked, and what was not

Checked, in Docker on an arm64 OrbStack VM (arm64 natively, amd64 emulated; build and
smoke test pass on both):

- `go vet`, golangci-lint and `go test -race` for linux with cgo (`make linux-test`),
  plus `GOOS=linux` and `GOOS=windows` vet and lint without cgo from macOS.
- The app builds and both packages are produced for amd64 and arm64 (`make linux`).
- `make linux-smoke` starts the binary under Xvfb with a session bus, three times: system
  bus without bluetoothd ("The Bluetooth service is not running"), BlueZ with no adapter
  ("No Bluetooth adapter found"), BlueZ with its adapter off ("Bluetooth is off"). The
  container's kernel has no Bluetooth, so the real bluetoothd exits at once;
  `tools/fakebluez` answers `GetManagedObjects` in its place. The window renders (WebKitGTK,
  software rendering) and the app shuts down cleanly on SIGTERM.

Not checked:

- **Anything with a pedal.** Scanning, connecting, notifications, writes, drops and
  reconnects on BlueZ have never run. The code follows tinygo's Linux backend and the
  BlueZ D-Bus API, and the parts that could be unit-tested are.
- **The ALSA ports.** OrbStack's kernel has no `snd-seq`, so the loopback test
  (`TestALSALoopback`) skips; the smoke test only sees the "no sequencer" error path. CI
  tries `modprobe snd-seq` on the Ubuntu runner and runs the test if that works; it has
  not been seen passing yet.
- **The tray** against a real host (KDE, GNOME + AppIndicator, Xfce). The smoke test has
  no StatusNotifierWatcher, so it only exercises the "no tray host" path.
- **The theme** on a real desktop with a portal; launch at login after a real login; the
  AppImage and .deb on distributions other than the build image.

What a Linux tester with a pedal should try, in order: start from a terminal and watch
the log; Scan; connect; press switches with `aseqdump -p "Flintstep (Spark Control X)"`
running; send a CC back to the LED port (`amidi`/a DAW) in feedback mode; turn the pedal
off and on (reconnect); turn Bluetooth off and on; the tray menu; launch at login.

## Windows plan

### Bluetooth

tinygo-bluetooth has a WinRT backend (through `saltosystems/winrt-go`) that does scan,
connect, discovery, notifications and write-with-response.[^tg-readme] In v0.16
`Connect` goes through `BluetoothLEDevice.FromBluetoothAddressAsync`, so it can connect by
address without a scan, and keeps the link with `GattSession.MaintainConnection`.[^tg-gap]
v0.17.0 (2026-10-28) waits for the link in `Connect` and fixes disconnect handling;
upgrade before starting.[^tg-017]

Known problems to check first:

- Issue #294: `Connect`, discovery and `EnableNotifications` crash when not called from
  the main thread.[^tg-294] Wails owns the main thread, and the Manager calls the radio
  from its own goroutines. If it still happens with v0.17, the radio needs a dedicated
  OS thread (`runtime.LockOSThread` in one goroutine that runs every WinRT call, the
  others sending it work). This is the biggest risk on the Bluetooth side.
- Issue #312: notifications not received on some machines.[^tg-312]

Pedals Windows already holds: `BluetoothLEDevice.GetDeviceSelectorFromConnectionStatus
(Connected)` gives an AQS filter for `DeviceInformation.FindAllAsync`;[^win-selector]
winrt-go has generated neither, so they need generating (its generator skips methods
inherited from parent interfaces[^winrt-go]) or a few hand-written vtable calls. Filter the
results by name with `sparkx.IsName`, and resolve each to its address with
`BluetoothLEDevice.FromIdAsync`.

Pairing: Microsoft's GATT client guide never requires pairing; a GATT read, write or
`MaintainConnection` connects.[^win-gatt] UNCONFIRMED for this pedal: whether it works
unpaired, and whether a pedal paired in Settings stops advertising while Windows holds
it. That decides whether the "held" path matters on Windows as much as on macOS.

Addresses: a MAC address as on Linux, so the same remembered-pedal behaviour.

Test plan: unit tests stay on the fake; a Windows tester runs `flintstep-cli -scan`,
then the CLI bridge, then the app, with the pedal unpaired, then paired in Settings.

### Virtual MIDI

The hard part. Windows has never let an app create a virtual MIDI port without a
driver. Windows MIDI Services changes that.

**Windows MIDI Services** went generally available on 2026-02-17, rolling out to Windows
11.[^wms-ga] The service, the MIDI 2.0 driver and WinMM/WinRT MIDI 1.0 compatibility are
part of Windows. The app SDK (`Microsoft.Windows.Devices.Midi2`) is still a preview: its
API was locked in Preview 11 (2026-10-12), but apps ship the DLL, `.winmd` and `.pri`
themselves under a "go live" agreement that says not to ship below Windows 11 25H2, to
update once the API is in Windows, and to tell users they depend on a preview.[^wms-p11]
The current release notes support 25H2 and later; 24H2 is "unsupported", Windows 10 not
at all.[^wms-p13][^wms-p11] (The rollout blog lists 24H2 as well;[^wms-rollout] trust the
release notes.)

The API: `MidiVirtualDeviceManager.CreateVirtualDevice(MidiVirtualDeviceCreationConfig)`
in `Windows.Devices.Midi2.Transports.Virtual` returns a `MidiVirtualDevice`; the app
opens the device side and the service publishes a client endpoint other apps share.[^wms-virtual]
With `CreateOnlyUmpEndpoints` false, the service also creates WinMM and WinRT MIDI 1.0
ports, which is what Ableton, Reaper and friends open.[^wms-config] UNCONFIRMED: the exact
port names a MIDI 1.0 DAW sees. The LED port maps to messages the app receives on the
device side; they are UMP, so convert MIDI 1.0 channel-voice UMP (message type 2) back to
bytes before the parser.

Calling it from Go: the SDK is WinRT only, with C++/WinRT, C# and PowerShell samples and no
flat C API.[^wms-samples] winrt-go only contains the Bluetooth APIs. Options:

1. A small C++/WinRT DLL (`flintstep_midi.dll`) exporting `create(name) / send(bytes) /
   set_callback(fn) / close()`, loaded with `syscall.NewLazyDLL`, so no cgo in the Go build.
   C++/WinRT finds the app-local SDK DLL next to the executable without an activation
   manifest.[^wms-p11]
2. Generate the Midi2 bindings with winrt-go's generator. Its gaps (inherited methods,
   missing types) make this slower and riskier.
3. go-ole by hand. Too much vtable work for a preview API that may still move.

**Recommendation: option 1.** It keeps the WinRT surface in the language Microsoft
documents and tests, it is about 200 lines, and the Go side is the same three-function
seam as `coremidi`.

**Older Windows** (Windows 10, Windows 11 before 25H2):

- teVirtualMIDI (Tobias Erichsen's driver, used by loopMIDI) is "NOT freeware or
  shareware"; shipping software that uses it needs the author's prior clearance, with no
  public price or open-source terms.[^te-sdk] Not something to bundle in an MIT app without
  that conversation.
- Asking the user to install loopMIDI (supports Windows 7 to 10[^loopmidi]), create two
  ports, and having Flintstep open them with WinMM (`midiOutOpen` / `midiInOpen`, plain
  `golang.org/x/sys/windows` calls) needs no licence and no driver. It is clumsy but
  honest. On Windows 11 with MIDI Services the built-in loopback pairs in MIDI Settings do
  the same job, and Microsoft recommends them over loopMIDI.[^wms-ga][^steinberg]
  (loopMIDI ports can go missing under the new stack unless created before the service
  starts.[^steinberg-835])

So: **Windows MIDI Services virtual devices on 25H2+, and a "use existing MIDI ports"
mode for everything else**: the user picks an output port and an input port (loopMIDI
pair or MIDI Services loopback) in Settings, and the app sends and listens there. The
second mode is worth building first: it works on every Windows version, it is small, and
it unblocks testing everything else.

### Tray, login, theme, WebView2

- Tray: fyne.io/systray supports Windows, but there it creates a hidden window on the
  thread that registers it and runs a `GetMessage` loop in a goroutine without locking
  the OS thread.[^systray-win] Wails v2 locks the main thread for its own loop. UNCONFIRMED
  whether they coexist; the likely safe shape is `systray.Run` on its own goroutine with
  `runtime.LockOSThread`. Test this early. Fallback: Wails v2 has no tray, but a ~150-line
  `Shell_NotifyIconW` implementation with `x/sys/windows` is a known quantity.
- Login: `HKCU\Software\Microsoft\Windows\CurrentVersion\Run`, value `Flintstep` =
  `"<exe>" --hidden` (command line at most 260 characters; Windows may delay it).[^run-key]
  Same pure `Render`/parse pattern as the other two.
- Theme: Wails v2 already has `windows.Options.Theme` (`SystemDefault`, `Dark`, `Light`;
  system default follows changes).[^wails-theme] `systemIsDark` can read
  `HKCU\...\Themes\Personalize\AppsUseLightTheme` (widely used, not documented by
  Microsoft) or the documented `UISettings.GetColorValue(Foreground)` route.[^uisettings]
  Switching at runtime needs Wails' `WindowSetSystemDefaultTheme/DarkTheme/LightTheme`.
- WebView2 is part of Windows 11 and on "the vast majority" of Windows 10
  machines.[^webview2] Wails' NSIS installer checks for it and runs the bundled
  bootstrapper if missing.[^wails-nsis]

### Packaging and signing

- Installer: Wails' built-in NSIS (`wails build -nsis`, templates in
  `build/windows/installer`, needs `makensis`).[^wails-nsis] It is the least work and
  handles WebView2. MSIX would give clean install/uninstall and could carry the MIDI SDK
  files, but Wails does not generate it and it adds identity and signing requirements.
  Inno Setup or WiX are fine but duplicate what NSIS already does here. A portable zip
  alongside is cheap.
- Signing: unsigned apps get SmartScreen's "Windows protected your PC", and Smart App
  Control on Windows 11 can block them outright. Signing does not skip the warning
  either: "EV certificates no longer bypass SmartScreen"; reputation builds over
  downloads.[^smartscreen] Options:
  - Azure Artifact Signing (formerly Trusted Signing): $9.99/month Basic.[^smartscreen]
    Individuals only in the US and Canada; organisations in the EU, UK and a few other
    countries.[^artifact-quickstart] An individual in Europe is not eligible; a company there would be.
  - SignPath Foundation: free for OSI-licensed open-source projects that already ship
    releases; the certificate names "SignPath Foundation" as publisher, each release is
    approved, and acceptance is at their discretion.[^signpath]
  - An OV certificate: around $129/year (SSL.com) plus a hardware token (~$379), or
    $219-$400 elsewhere; keys must live on FIPS 140-2 Level 2 hardware since June 2023,
    and certificates issued from March 2026 last at most 460 days.[^ssl-com][^ssldragon][^hsm][^csc31]
  - Recommendation: apply to SignPath first (free, fits the project); ship unsigned and
    say so in the release notes until then, as the macOS build did before notarisation.

### CI

`windows-latest` (Windows Server 2025) has Go 1.25/1.26, Node 22, gcc, Inno Setup and
WiX; NSIS and bun are not listed, so install them (choco/winget, `oven-sh/setup-bun`).[^runner]
No Bluetooth hardware. A job that runs `go vet`, the tests, the Wails build and the NSIS
installer is straightforward; the MIDI DLL needs MSVC (present on the image) and
C++/WinRT (NuGet).

### Needs a Windows tester with a pedal

Everything Bluetooth (connect, notifications from goroutines, issue #294), the held-pedal
path, pairing behaviour, the MIDI Services virtual device and the port names DAWs show,
LED feedback round trip, tray coexistence with Wails, SmartScreen on a fresh machine.

### Effort and order

Rough, for someone who knows Go and has a Windows machine and a pedal:

| Step | Effort |
| --- | --- |
| 1. Windows CI job: build, tests, NSIS installer, unsigned | 1 day |
| 2. Login item (Run key), theme, window policy, single instance | 1 day |
| 3. Radio: tinygo v0.17 on WinRT, held pedals, thread question | 3-5 days |
| 4. MIDI "existing ports" mode via WinMM (loopMIDI / MIDI Services loopback) | 2 days |
| 5. Tray (fyne systray or `Shell_NotifyIconW`) | 1-2 days |
| 6. MIDI Services virtual device via a C++/WinRT DLL, 25H2+ | 4-6 days |
| 7. Signing (SignPath application), release job | 1-2 days plus waiting |

Order: 1, 2, 3 and 4 give a usable app (pedal in, MIDI out through a loopback port).
5 makes it behave like the other two. 6 removes the loopback setup on new Windows, and
is worth doing once Microsoft moves the SDK in-box, which should also make the DLL
shipping question go away. Two to three weeks in total, most of it in steps 3 and 6,
and most of the risk in the WinRT threading.

## Sources

[^tg-readme]: tinygo-org/bluetooth v0.16.0 README, platform support table. <https://github.com/tinygo-org/bluetooth/blob/v0.16.0/README.md>
[^tg-gap]: tinygo-org/bluetooth v0.16.0, `gap_windows.go` and `gattc_windows.go`. <https://github.com/tinygo-org/bluetooth/blob/v0.16.0/gap_windows.go>
[^tg-017]: tinygo-org/bluetooth CHANGELOG, v0.17.0. <https://github.com/tinygo-org/bluetooth/blob/v0.17.0/CHANGELOG.md>
[^tg-294]: tinygo-org/bluetooth issue #294. <https://github.com/tinygo-org/bluetooth/issues/294>
[^tg-312]: tinygo-org/bluetooth issue #312. <https://github.com/tinygo-org/bluetooth/issues/312>
[^winrt-go]: saltosystems/winrt-go README. <https://github.com/saltosystems/winrt-go>
[^win-selector]: `BluetoothLEDevice.GetDeviceSelectorFromConnectionStatus`, Microsoft Learn. <https://learn.microsoft.com/en-us/uwp/api/windows.devices.bluetooth.bluetoothledevice.getdeviceselectorfromconnectionstatus>
[^win-gatt]: Bluetooth GATT client, Microsoft Learn. <https://learn.microsoft.com/en-us/windows/apps/develop/devices-sensors/gatt-client>
[^wms-ga]: "Making music with MIDI just got a real boost in Windows 11", Windows Experience Blog, 2026-02-17. <https://blogs.windows.com/windowsexperience/2026/02/17/making-music-with-MIDI-just-got-a-real-boost-in-windows-11/>
[^wms-rollout]: Windows MIDI Services rollout: known issues and workarounds. <https://devblogs.microsoft.com/windows-music-dev/windows-midi-services-rollout-known-issues-and-workarounds/>
[^wms-p11]: microsoft/MIDI release notes, inbox-preview-11. <https://github.com/microsoft/MIDI/releases/tag/inbox-preview-11>
[^wms-p13]: microsoft/MIDI release notes, inbox-preview-13. <https://github.com/microsoft/MIDI/releases/tag/inbox-preview-13>
[^wms-virtual]: Windows MIDI Services SDK reference, Virtual transport. <https://github.com/microsoft/MIDI/blob/main/docs/sdk-reference/Transports/Virtual/index.md>
[^wms-config]: `MidiVirtualDeviceCreationConfig`. <https://github.com/microsoft/MIDI/blob/main/docs/sdk-reference/Transports/Virtual/MidiVirtualDeviceCreationConfig.md>
[^wms-samples]: microsoft/MIDI samples. <https://github.com/microsoft/MIDI/tree/main/samples>
[^te-sdk]: teVirtualMIDI SDK. <https://www.tobias-erichsen.de/software/virtualmidi/virtualmidi-sdk.html>
[^loopmidi]: loopMIDI. <https://www.tobias-erichsen.de/software/loopmidi.html>
[^steinberg]: "The Microsoft Windows MIDI Services rollout: important info", Steinberg forums. <https://forums.steinberg.net/t/the-microsoft-windows-midi-services-rollout-important-info/1025581>
[^steinberg-835]: "Loop MIDI hidden in Windows 11 25H2: fix" (microsoft/MIDI #835). <https://forums.steinberg.net/t/loop-midi-hidden-in-windows-11-25h2-fix/1024008>
[^systray-win]: fyne-io/systray, `systray_windows.go`. <https://github.com/fyne-io/systray/blob/master/systray_windows.go>
[^run-key]: Run and RunOnce registry keys, Microsoft Learn. <https://learn.microsoft.com/en-us/windows/win32/setupapi/run-and-runonce-registry-keys>
[^wails-theme]: Wails v2.17.1 `options/windows`. <https://github.com/wailsapp/wails/blob/v2.17.1/v2/pkg/options/windows/windows.go>
[^uisettings]: Apply Windows themes, Microsoft Learn. <https://learn.microsoft.com/en-us/windows/apps/desktop/modernize/ui/apply-windows-themes>
[^webview2]: Distribute the WebView2 runtime, Microsoft Learn. <https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/distribution>
[^wails-nsis]: Wails Windows installer guide. <https://github.com/wailsapp/wails/blob/master/website/docs/guides/windows-installer.mdx>
[^smartscreen]: SmartScreen reputation for Windows app developers, Microsoft Learn. <https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/smartscreen-reputation>
[^artifact-quickstart]: Artifact Signing quickstart, Microsoft Learn. <https://learn.microsoft.com/en-us/azure/artifact-signing/quickstart>
[^signpath]: SignPath Foundation terms. <https://signpath.org/terms>
[^ssl-com]: SSL.com code signing prices. <https://www.ssl.com/certificates/code-signing/buy/>
[^ssldragon]: SSL Dragon code signing prices. <https://www.ssldragon.com/ssl-certificates/code-signing/>
[^hsm]: DigiCert, code signing private key storage requirement. <https://knowledge.digicert.com/alerts/code-signings-new-private-key-storage-requirement>
[^csc31]: CA/Browser Forum ballot CSC-31. <https://cabforum.org/2025/11/17/ballot-csc-31-maximum-validity-reduction>
[^runner]: GitHub Actions Windows Server 2025 image. <https://github.com/actions/runner-images/blob/main/images/windows/Windows2025-VS2026-Readme.md>
