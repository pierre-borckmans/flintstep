import type { Activity, Config, Device, ExpEdge, State } from "./types";

/** What the UI needs from the Go side. In the desktop app this is the Wails
 *  binding of `App` in package main; in a plain browser it is the mock. */
export interface Backend {
  GetState(): Promise<State>;
  SaveConfig(cfg: Config): Promise<void>;
  ResetConfig(): Promise<Config>;
  Scan(): Promise<Device[]>;
  ChoosePedal(address: string, name: string): Promise<void>;
  ForgetPedal(): Promise<void>;
  CalibrateExp(n: number, edge: ExpEdge): Promise<Config>;
  SetLaunchAtLogin(on: boolean): Promise<void>;
  RevealLogs(): Promise<void>;
  onState(cb: (s: State) => void): () => void;
  onActivity(cb: (a: Activity) => void): () => void;
}

type GoApp = Omit<Backend, "onState" | "onActivity">;

interface WailsRuntime {
  EventsOn(name: string, cb: (...data: unknown[]) => void): (() => void) | undefined;
  EventsOff?(name: string, ...rest: string[]): void;
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
    ResetConfig: () => app.ResetConfig(),
    Scan: () => app.Scan(),
    ChoosePedal: (address, name) => app.ChoosePedal(address, name),
    ForgetPedal: () => app.ForgetPedal(),
    CalibrateExp: (n, edge) => app.CalibrateExp(n, edge),
    SetLaunchAtLogin: (on) => app.SetLaunchAtLogin(on),
    RevealLogs: () => app.RevealLogs(),
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

/** Wails rejects with a string; Error objects come from the mock. */
export function errorText(e: unknown): string {
  if (e instanceof Error) return e.message;
  return String(e);
}
