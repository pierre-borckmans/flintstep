# Spark Control X: protocol notes found while building the bridge

Additions to the protocol in internal/sparkx and Paul Hamshere's notes. Checked on
firmware 4.1.23 with tools/probe/power.swift (read-only).

## REACTOR Control (2026-11-05, desk research only, no hardware)

Positive Grid's footswitch for the REACTOR 50 and 100 amps. The maintainer says it is
physically the Spark Control X: same chassis, six switches, LEDs. The Spark Control X
reports "AirTurn" as its manufacturer in Device Information, so the REACTOR Control is
almost certainly the same AirTurn hardware with other branding and firmware. Nobody has
reported on one connected to anything but its amp yet.

What Positive Grid's own pages say:

| | Spark Control X | REACTOR Control |
| --- | --- | --- |
| Size, battery | same dimensions, 750 mAh | same dimensions, 750 mAh [^rc-spec] [^scx-spec] |
| Expression jacks | 2 | **1** [^rc-hw] |
| Extra controls | Bluetooth button | a Function button instead, and a 1/4" TRS output [^rc-hw] |
| Bluetooth | BLE | Bluetooth 5.0, 17 m [^rc-spec] |
| "Wired" | n/a | 1/4" TRS cable to the amp's REACTOR Control jack (3 m, included) [^rc-hw] |
| USB-C | charging, firmware | "Charging Port (DC IN 5V/2A)"; the cable is "for charging" [^rc-spec] |
| Firmware | 4.1.23 (Aug 2024), over the air from the Spark app [^scx-fw] | ships with its firmware, "no new firmware has been released yet"; no update method described [^rc-fw] |
| Pairs with | Spark amps and the Spark app | the amp: hold the amp's Pair button. It never pairs with a phone [^rc-faq] |

- "Wired" is NOT USB. Nothing mentions USB-MIDI or HID, and Positive Grid says it "does
  not function as a general-purpose MIDI controller" [^rc-faq]. The amp's manual says MIDI
  In and the REACTOR Control jack are mutually exclusive [^amp-midi], which hints that the
  TRS link carries MIDI or serial, but nothing says so. Flintstep only uses Bluetooth.
- Amp firmware 0.2.5.41 (2026-10-19) "automatically reconnects to the last Reactor Control
  it was paired with" [^amp-fw]. So the amp holds the pedal much as a Spark amp does: turn
  the amp off (or out of range) before Flintstep looks for the pedal.
- The amps advertise "REACTOR 50 BT Control" / "REACTOR 100 BT Control" for app control
  and "REACTOR 50/100 BT Audio" for audio [^app-faq]. Those are the amp, not the pedal.
  That is why the model registry never matches a bare "REACTOR" prefix.

UNKNOWN, to be filled in from the first compatibility report (.github/ISSUE_TEMPLATE/
pedal_compatibility.yml):

- **The advertised Bluetooth name.** Not in any manual, FAQ or spec page found. FCC
  filings (fccid.io) and GitHub could not be reached from the research session. The
  registry's REACTOR prefixes (internal/sparkx/models.go) are guesses; a pedal with any
  other name is still accepted once the user picks it, by its services.
- Whether it exposes the same services: switch `7BDB8DC0-…`, command `FFC8`
  (`FFC9`/`FFCA`), the power service `6FACFE71-…`, Battery `180F`, BLE-MIDI.
- Whether the FFC9/FFCA messages, the lamp messages (`0x01`) and the info requests are
  byte-identical, and what the single expression jack and the Function button send
  (probably `0x0c` with input 2 always unplugged, and a seventh bit in the switch mask or a
  new FFCA type; both guesses).
- Whether it needs bonding before a host other than the amp can talk to it.
- Its firmware version string and whether the `0x0b` reply looks like the Spark Control
  X's.
- Paul Hamshere's notes (github.com/paulhamsh/Spark-Control-X) and the other community
  pages found say nothing about it.

Sources (Positive Grid help centre; the pages refuse plain fetches, the Zendesk API
`https://help.positivegrid.com/api/v2/help_center/en-us/articles/<id>.json` serves them):

[^rc-spec]: Technical Specification for REACTOR Control, <https://help.positivegrid.com/hc/en-us/articles/35952632715661>
[^scx-spec]: Technical Specification for Spark Control X, <https://help.positivegrid.com/hc/en-us/articles/22702916264461>
[^rc-hw]: REACTOR Control hardware overview, <https://help.positivegrid.com/hc/en-us/articles/44632037941645>
[^rc-fw]: REACTOR Control Firmware Update, <https://help.positivegrid.com/hc/en-us/articles/35952660717325>
[^scx-fw]: Spark Control X Firmware Release Notes, <https://help.positivegrid.com/hc/en-us/articles/29418411269517>
[^rc-faq]: REACTOR Control FAQ, <https://help.positivegrid.com/hc/en-us/articles/45781417522573>
[^amp-midi]: REACTOR MIDI Control Commands Setup, <https://help.positivegrid.com/hc/en-us/articles/44536008858509>
[^amp-fw]: REACTOR 50/100 Firmware Release Notes, <https://help.positivegrid.com/hc/en-us/articles/44385183933709>
[^app-faq]: REACTOR App FAQ, <https://help.positivegrid.com/hc/en-us/articles/45779393869069>

Product page: <https://www.positivegrid.com/products/reactor-control>.

## USB power (2026-11-04)

Two sources report whether the USB cable is powering the pedal. Unplugged at ~12 s and
replugged at ~27 s:

| Source | Plugged | Unplugged | Latency |
| --- | --- | --- | --- |
| Request `11 00 00 00` on FFC9, reply on FFCA | `11 00 00 00 01` | `11 00 00 00 00` | as fast as you poll |
| Characteristic `90D9A098-9CD8-4A7A-B176-91FFE80909F2` (service `6FACFE71-A4C3-4E80-BA5C-533928830727`, read + notify) | `01` | `00` | pushed, ~1 s |

Paul's notes list `0x11` as an unknown request a Spark II amp sends routinely; it is
read-only. `0x10` replied `10 00 00 00 00` throughout and did not change.

Nothing says "charging" as such. Charging = USB power and battery below 100 %.

The battery level (0x0f reply, and standard Battery Level 2A19, which notifies) rose
from 20 % to 30 % over a few minutes on USB.

Other values that changed during the run are counters, not power:
`FBEEEB29-…` and `1BCF02E0-…` (service `97A16290-…`) tick every ~2 s.

## Lamps belong to the pedal

Every connected host writes the same eight lamps. A second client disconnecting (and
darkening its lamps) turns ours off too. The bridge rewrites all lamps every 3 s.

## Profile changes (2026-11-04, inconclusive)

`85DA4F4B-A2CA-4C7C-8C7D-FCD9E2DAAD56` sits in the switch service (`7BDB8DC0-…`), is
read/write/notify, and reads the active profile number (`09`, matching the `08` reply).
It is writable: never write it.

Probed with tools/probe/profile.swift on profile 9 "Looper #1": long press A twice, then
B twice. The profile did not change (neither `85DA4F4B` nor the `08` reply moved), because
in a looper profile A and B hold actions are looper commands, not profile steps:

| Press | Switch byte | FFCA |
| --- | --- | --- |
| long A | `04` | `03 00 00 00 08` |
| long B | `20` | `03 00 00 00 45`, then `03 00 00 00 47` ~1 s later while still held |

So the pedal has its own hold action (a second command after ~1 s). Whether `85DA4F4B`
notifies on a profile change is still open: rerun the probe from a non-looper profile.

## Expression inputs (2026-11-04)

- The `0x0c` stream is NOT continuous. With a cable in jack 1 reading a steady value,
  the pedal sent no `0x0c` at all for 25 s (tools/probe/exp.swift). An earlier
  note of "about 60 a second even when idle" was probably noise on an empty jack.
- `BD066DA4-F9EC-4F0D-A53C-1CD99147A641` (switch service, read + notify) holds the same
  payload as `0x0c`: `01 <lo> <hi> 02 <lo> <hi>`. All zeros with no cable; `01 00 00 02 00
  00` with a cable. Readable on connect, so the app can show where a pedal rests before
  it moves.
- A TS (mono, one black ring) cable is detected (`0d` reports the jack plugged) but reads
  0 at every position: the jack needs TRS (two rings) for the pedal's wiper.

## Correction: 0x11 / 90D9A098 mean "charging", not "USB connected" (2026-11-05)

Left plugged in overnight: the pedal's POWER LED went steady green and both flags read
`00` with the cable still in. Unplugging changed nothing; replugging set both to `01`
within ~2 s and the LED started blinking green. So the flag is "charging now": plugged in
but done charging is indistinguishable from on battery. Battery still read 61 % (0x0f and
2A19 agree), so the pedal's charger stops before its gauge says 100.

POWER LED colours seen: blinking yellow at ~30 % (charging), steady green at 61 % (not
charging), blinking green at 61 % (charging). Green therefore starts somewhere in 31..61 %.

`2BEA` read `02 13` while charging and `02 10` when not: bits 0-1 track charging too.
