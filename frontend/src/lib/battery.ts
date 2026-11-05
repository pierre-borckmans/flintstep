import { LOW } from "./power";

// THE BATTERY READOUT. The pedal reports a level and a "charging now" flag. Plugged in
// but done charging reads exactly like running on battery, so the readout only ever
// claims "charging", never "on battery" or "on USB power".

export type Power = "battery" | "charging" | "usb";

export function batteryInfo(level: number, charging: boolean): { power: Power; tooltip: string } {
  if (charging) return { power: "charging", tooltip: `Battery ${level}%, charging` };
  return {
    power: "battery",
    tooltip: level < LOW ? `Battery ${level}%, low: plug the pedal in` : `Battery ${level}%`,
  };
}
