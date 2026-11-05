import type { ThemeMode } from "./lib/theme";
import type { Activity, Config, Device, ExpEdge, PresetInfo, PresetSource, State } from "./types";

/** What the UI needs from the Go side. In the desktop app this is the Wails
 *  binding of `App` in package main; in a plain browser it is the mock. */
export interface Backend {
  GetState(): Promise<State>;
  /** Saves into the active preset. */
  SaveConfig(cfg: Config): Promise<void>;
  /** Saves into preset `id`; Go runs it only if `id` is the active preset at that moment. */
  SaveConfigInto(id: string, cfg: Config): Promise<void>;
  ResetConfig(): Promise<Config>;
  Scan(): Promise<Device[]>;
  ChoosePedal(address: string, name: string): Promise<void>;
  ForgetPedal(): Promise<void>;
  CalibrateExp(n: number, edge: ExpEdge): Promise<Config>;
  SetLaunchAtLogin(on: boolean): Promise<void>;
  /** Turns input n's simulated expression pedal on (at the heel) or off. Refused while a
   *  real cable is in the jack; a real cable plugged in later turns it off. Not saved. */
  SimulateExp(n: number, on: boolean): Promise<void>;
  /** Moves input n's simulated pedal to `fraction` 0 (heel) .. 1 (toe), raw 0..65535
   *  linearly. Turns the simulation on if needed and stops a sweep. */
  SetSimExp(n: number, fraction: number): Promise<void>;
  /** Sweeps input n's simulated pedal heel → toe → heel every 4 s, eased, from where it
   *  is; on turns the simulation on if needed. */
  SimSweep(n: number, on: boolean): Promise<void>;
  RevealLogs(): Promise<void>;
  /** Themes the native window (appearance, background) and keeps it for the next launch. */
  SetTheme(mode: ThemeMode): Promise<void>;
  ListPresets(): Promise<PresetInfo[]>;
  /** Makes the preset the active one and runs it; resolves to its mapping. */
  SelectPreset(id: string): Promise<Config>;
  /** Not activated. A blank name picks "New preset", made unique. */
  CreatePreset(name: string, from: PresetSource): Promise<PresetInfo>;
  RenamePreset(id: string, name: string): Promise<void>;
  DuplicatePreset(id: string): Promise<PresetInfo>;
  /** The last one cannot go; deleting the active one runs its neighbour. */
  DeletePreset(id: string): Promise<void>;
  /** Native save panel; a cancel resolves. */
  ExportPreset(id: string): Promise<void>;
  /** Native open panel; a cancel resolves to id "". Not activated. */
  ImportPreset(): Promise<PresetInfo>;
  onState(cb: (s: State) => void): () => void;
  onActivity(cb: (a: Activity) => void): () => void;
}

type GoApp = Omit<Backend, "onState" | "onActivity">;

interface WailsRuntime {
  EventsOn(name: string, cb: (...data: unknown[]) => void): (() => void) | undefined;
  EventsOff?(name: string, ...rest: string[]): void;
  BrowserOpenURL?(url: string): void;
}

declare global {
  interface Window {
    go?: { main?: { App?: GoApp } };
    runtime?: WailsRuntime;
  }
}

/** Wails' own `wailsjs` bindings are generated at build time; these calls are what they
 *  wrap, so nothing here depends on that folder existing. */
function wailsBackend(app: GoApp, rt: WailsRuntime): Backend {
  const on =
    <T>(name: string) =>
    (cb: (v: T) => void) => {
      const off = rt.EventsOn(name, (v) => cb(v as T));
      return () => {
        if (typeof off === "function") off();
        else rt.EventsOff?.(name);
      };
    };
  return {
    GetState: () => app.GetState(),
    SaveConfig: (cfg) => app.SaveConfig(cfg),
    SaveConfigInto: (id, cfg) => app.SaveConfigInto(id, cfg),
    ResetConfig: () => app.ResetConfig(),
    Scan: () => app.Scan(),
    ChoosePedal: (address, name) => app.ChoosePedal(address, name),
    ForgetPedal: () => app.ForgetPedal(),
    CalibrateExp: (n, edge) => app.CalibrateExp(n, edge),
    SetLaunchAtLogin: (on) => app.SetLaunchAtLogin(on),
    SimulateExp: (n, on) => app.SimulateExp(n, on),
    SetSimExp: (n, f) => app.SetSimExp(n, f),
    SimSweep: (n, on) => app.SimSweep(n, on),
    RevealLogs: () => app.RevealLogs(),
    SetTheme: (mode) => app.SetTheme(mode),
    ListPresets: () => app.ListPresets(),
    SelectPreset: (id) => app.SelectPreset(id),
    CreatePreset: (name, from) => app.CreatePreset(name, from),
    RenamePreset: (id, name) => app.RenamePreset(id, name),
    DuplicatePreset: (id) => app.DuplicatePreset(id),
    DeletePreset: (id) => app.DeletePreset(id),
    ExportPreset: (id) => app.ExportPreset(id),
    ImportPreset: () => app.ImportPreset(),
    onState: on<State>("state"),
    onActivity: on<Activity>("activity"),
  };
}

/** The Wails bridge when it is there, otherwise the simulated pedal (browser dev).
 *  The mock is a dynamic import so it never ships in the desktop bundle's main chunk. */
export async function loadBackend(): Promise<{ backend: Backend; mock: boolean }> {
  const app = window.go?.main?.App;
  if (app && window.runtime) return { backend: wailsBackend(app, window.runtime), mock: false };
  const { createMockBackend } = await import("./mock");
  return { backend: createMockBackend(new URLSearchParams(window.location.search)), mock: true };
}

/** Opens a URL with the system (a web page, or a System Settings pane). Wails' runtime
 *  hands it to macOS; in the browser mock it is only logged. */
export function openURL(url: string) {
  if (window.runtime?.BrowserOpenURL) window.runtime.BrowserOpenURL(url);
  else console.info("[mock] open", url);
}

/** Wails rejects with a string; Error objects come from the mock. */
export function errorText(e: unknown): string {
  if (e instanceof Error) return e.message;
  return String(e);
}
