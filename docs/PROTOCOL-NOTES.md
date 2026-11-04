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
