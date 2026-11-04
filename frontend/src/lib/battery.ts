// THE BATTERY READOUT. The pedal reports a level and whether USB powers it, never
// "charging": that is USB power with the level below 100 %, as app.go's menu says it.

export type Power = "battery" | "charging" | "usb";

export function batteryInfo(level: number, powered: boolean): { power: Power; tooltip: string } {
  const power: Power = !powered ? "battery" : level < 100 ? "charging" : "usb";
  const words = { battery: "On battery", charging: "Charging", usb: "On USB power" }[power];
  return { power, tooltip: `${words} · ${level}%` };
}
