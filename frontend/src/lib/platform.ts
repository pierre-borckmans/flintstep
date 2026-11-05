// WHICH DESKTOP THE APP RUNS ON, for the few words that differ (Finder, "this Mac",
// System Settings). Read from the webview: WKWebView says "MacIntel", WebKitGTK
// "Linux x86_64" / "Linux aarch64". The browser mock reads the developer's machine.

export type OS = "mac" | "linux" | "other";

/** os classifies navigator.platform (or, without it, the user agent). */
export function os(platform: string, userAgent = ""): OS {
  const p = `${platform} ${platform ? "" : userAgent}`.toLowerCase();
  if (p.includes("mac")) return "mac";
  if (p.includes("linux") && !p.includes("android")) return "linux";
  return "other";
}

/** The OS this window runs on. */
export const OS_NOW: OS =
  typeof navigator === "undefined"
    ? "mac"
    : os(navigator.platform ?? "", navigator.userAgent ?? "");

/** "this Mac" or "this computer". */
export function thisComputer(o: OS = OS_NOW): string {
  return o === "mac" ? "this Mac" : "this computer";
}

/** What the system's look is called: "macOS" or "the desktop". */
export function systemLookName(o: OS = OS_NOW): string {
  return o === "mac" ? "macOS" : "the desktop";
}

/** The label of the button that shows the log folder. */
export function revealLabel(o: OS = OS_NOW): string {
  return o === "mac" ? "Reveal in Finder" : "Open the folder";
}

/** A shortcut written the Mac way ("⇧⌘Z") as key caps for a tooltip's data-kbd: as it
 *  is on a Mac, "Ctrl Shift Z" elsewhere (ui/tooltip splits caps on spaces). */
export function keys(mac: string, o: OS = OS_NOW): string {
  if (o === "mac") return mac;
  const mods = [
    mac.includes("⌘") && "Ctrl",
    mac.includes("⇧") && "Shift",
    mac.includes("⌥") && "Alt",
  ];
  const key = mac.replace(/[⌘⇧⌥]/g, "");
  return [...mods.filter(Boolean), key].join(" ");
}
