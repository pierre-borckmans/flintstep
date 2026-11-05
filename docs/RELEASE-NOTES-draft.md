# Release notes draft: SparkX MIDI is now Flintstep

SparkX MIDI has a new name, Flintstep, and a new home at <https://flintstep.app>. It
works the same way. What changes for you if you used SparkX MIDI:

- **New MIDI ports.** The device your DAW sees is now **Flintstep (Spark Control X)**,
  and the LED feedback port is **Flintstep LEDs (Spark Control X)**. CoreMIDI identifies
  ports by an id derived from the app's identity, so your DAW sees a new device. Select
  it again wherever you used "Spark Control X".
- **Bluetooth permission again.** macOS treats Flintstep as a new app and asks once.
- **Your presets move with you.** On first launch Flintstep moves
  `~/Library/Application Support/SparkX MIDI` to `~/Library/Application Support/Flintstep`.
  If the move fails, it keeps using the old folder and tries again next launch.
- **Launch at login carries over.** If it was on, Flintstep turns it on for itself and
  removes the old login item.
- **Exports.** New exports are `.flintstep.json`. Your old `.sparkx.json` files still
  import.
- **Theme.** The window starts in the theme you picked, but the setting may fall back to
  "follow macOS" once. Pick it again in Settings if so.
- The pedal drawing no longer shows the maker's wordmark.

You can delete `SparkX MIDI.app` once Flintstep is running.
