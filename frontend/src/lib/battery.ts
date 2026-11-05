// THE BATTERY READOUT. The pedal reports a level and a "charging now" flag. Plugged in
// but done charging reads exactly like running on battery, so the readout only ever
// claims "charging", never "on battery" or "on USB power".

export type Power = "battery" | "charging" | "usb";

export function batteryInfo(level: number, charging: boolean): { power: Power; tooltip: string } {
  return charging
    ? { power: "charging", tooltip: `Charging · ${level}%` }
    : { power: "battery", tooltip: `Battery ${level}%` };
}
