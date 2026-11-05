# Linux (experimental)

The Linux build compiles, packages and starts, and CI smoke-tests it in a container. Nobody has used it with a real pedal yet. If you try it, [open an issue](https://github.com/pierre-borckmans/flintstep/issues) with your distribution, desktop and `~/.config/Flintstep/app.log`.

## Install

Releases that include it carry `Flintstep-<version>-x86_64.AppImage` / `-aarch64.AppImage`, `flintstep_<version>_amd64.deb` / `_arm64.deb` and `SHA256SUMS-linux.txt`.

- `.deb` (Debian 12+, Ubuntu 22.04+): `sudo apt install ./flintstep_<version>_amd64.deb`. It pulls in GTK 3, WebKitGTK 4.1 and ALSA, and recommends BlueZ.
- AppImage: `chmod +x Flintstep-*.AppImage` and run it. It doesn't bundle GTK or WebKit, so it needs `libwebkit2gtk-4.1-0`, `libasound2` and FUSE 2 or 3.

## What it needs

- BlueZ, running (`systemctl status bluetooth`). The app talks to `bluetoothd` over the system D-Bus, which the default policy allows for a logged-in user. If the app says it isn't allowed, check `/etc/dbus-1/system.d/bluetooth.conf`. "Blocked by rfkill" means `rfkill unblock bluetooth`.
- The ALSA sequencer (`/dev/snd/seq`, module `snd-seq`). Your user must be able to open it: logged in at the seat, or in the `audio` group. The ports are **Flintstep** and **Flintstep LEDs**. PipeWire and JACK apps see them through their ALSA MIDI bridges; `aconnect -l` lists them.
- A tray for the menu-bar behaviour. KDE, Xfce, Cinnamon and Ubuntu's GNOME have one; stock GNOME needs the AppIndicator extension. Without a tray, closing the window quits the app.

## Notes

The remembered pedal is stored per OS (a MAC address here, a CoreBluetooth identifier on macOS), so the first launch on Linux finds the pedal again by name. "Launch at login" writes `~/.config/autostart/flintstep.desktop`. Data lives in `~/.config/Flintstep/`.

Build it yourself with `make linux` (Docker). [PORTING.md](PORTING.md) has what was tested and how.
