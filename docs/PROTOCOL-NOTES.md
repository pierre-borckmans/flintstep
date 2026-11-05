# Spark Control X: protocol notes found while building the bridge

Additions to the protocol in internal/sparkx and Paul Hamshere's notes. Checked on
firmware 4.1.23 with tools/probe/power.swift (read-only).

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
  the pedal sent no `0x0c` at all for 25 s (tools/probe/exp.swift). The design doc's
  "about 60 a second even when idle" was probably noise on an empty jack.
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
