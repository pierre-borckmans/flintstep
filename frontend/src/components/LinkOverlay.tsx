import {
  Bluetooth,
  BluetoothOff,
  BluetoothSearching,
  ExternalLink,
  Radar,
  Unplug,
} from "lucide-react";
import { type CSSProperties, useEffect, useRef, useState } from "react";
import type { Backend } from "../api";
import { openURL } from "../api";
import {
  BLUETOOTH_SETTINGS,
  type LinkAction,
  type LinkView,
  linkView,
  SWEEP_MS,
  sweepLamps,
} from "../lib/linkview";
import type { Colour, Config, Status } from "../types";
import { Button } from "../ui/Button";
import { ScanResults, usePedalScan } from "./PedalScan";
import "./LinkOverlay.css";

// THE LINK, SHOWN ON THE PEDAL. While the pedal is not connected it sits powered down
// with sonar going out from it (searching) or closing in on it (connecting), and a card
// over its lower edge says what is happening and what to do. When the link comes up the
// rings fall into the case, the colour comes back and the LEDs sweep once, left to right.
// Only the card takes the pointer: the pedal's switches stay clickable behind it.

/** How long the card and rings take to leave once the pedal connects (ms). */
const LEAVE_MS = 620;

/** Browser dev only (read once mounted: the mock flag is set after this module loads).
 *  ?freeze=900 stops every ring at 900 ms into its cycle, for stills; ?scan=auto starts a
 *  scan as the card opens. */
function devParam(name: string): string | null {
  if (typeof document === "undefined" || !document.documentElement.dataset.mock) return null;
  return new URLSearchParams(window.location.search).get(name);
}
const freezeMs = () => {
  const v = devParam("freeze");
  return v !== null && /^\d+$/.test(v) ? Number(v) : null;
};

const reducedMotion = () =>
  typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export type LinkPhase = "in" | "leaving" | "gone";

/** The overlay's life: what it shows, whether it is arriving, leaving or gone, and the
 *  lamps to draw (the pedal's own, or the power-up sweep over them). */
export function useLink(status: Status | null, config: Config | null) {
  const view = linkView(status, config?.pedal ?? { address: "", name: "" });
  const [shown, setShown] = useState<LinkView | null>(view.visible ? view : null);
  const [phase, setPhase] = useState<LinkPhase>(view.visible ? "in" : "gone");
  const [sweepAt, setSweepAt] = useState<number | null>(null);
  const [now, setNow] = useState(0);
  const was = useRef(status?.state ?? null);

  // Keep the card's words current while it is up; freeze them while it leaves.
  if (view.visible) {
    if (phase !== "in") setPhase("in");
    if (JSON.stringify(shown) !== JSON.stringify(view)) setShown(view);
  }

  const state = status?.state ?? null;
  useEffect(() => {
    const before = was.current;
    was.current = state;
    if (state !== "connected" || before === null || before === "connected") return;
    // Just connected.
    if (reducedMotion()) {
      setPhase("gone");
      return;
    }
    setPhase("leaving");
    setSweepAt(performance.now());
    const t = setTimeout(() => setPhase((p) => (p === "leaving" ? "gone" : p)), LEAVE_MS);
    return () => clearTimeout(t);
  }, [state]);

  // The sweep's clock: a frame at a time while it runs.
  useEffect(() => {
    if (sweepAt === null) return;
    let raf = 0;
    const tick = () => {
      const t = performance.now() - sweepAt;
      setNow(t);
      if (t < SWEEP_MS + 260) raf = requestAnimationFrame(tick);
      else setSweepAt(null);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [sweepAt]);

  // The rings rest a beat before the LEDs light, so the sweep follows the collapse.
  const lamps = (base: Colour[]): Colour[] =>
    sweepAt === null || state !== "connected" ? base : sweepLamps(now - 260, base, config);

  return { view: shown, phase: shown ? phase : "gone", lamps };
}

/** The rings round the case, drawn behind it. `rect` is the case in the stage's px. */
export function LinkRings({
  view,
  phase,
  rect,
}: {
  view: LinkView | null;
  phase: LinkPhase;
  rect: { x: number; y: number; w: number; h: number } | null;
}) {
  if (!rect || !view || phase === "gone" || view.rings === "none") return null;
  const FREEZE = freezeMs();
  const mode = phase === "leaving" ? "collapse" : view.rings;
  return (
    <div
      aria-hidden
      className="link-rings"
      data-rings={mode}
      data-frozen={FREEZE !== null || undefined}
      style={
        {
          left: rect.x,
          top: rect.y,
          width: rect.w,
          height: rect.h,
          "--case-r": `${rect.w * 0.05}px`,
          "--freeze": FREEZE === null ? undefined : `${-FREEZE}ms`,
        } as CSSProperties
      }
    >
      {[0, 1, 2].map((i) => (
        <span key={i} className="link-ring" style={{ "--i": i } as CSSProperties} />
      ))}
      {mode === "collapse" && <span className="link-bloom" />}
    </div>
  );
}

const ICON = {
  searching: BluetoothSearching,
  connecting: Bluetooth,
  off: BluetoothOff,
  idle: Bluetooth,
} as const;

/** The card over the pedal's lower edge: what is happening, and what to do about it. */
export function LinkCard({
  view,
  phase,
  backend,
  config,
}: {
  view: LinkView | null;
  phase: LinkPhase;
  backend: Backend;
  config: Config | null;
}) {
  const scan = usePedalScan(backend);
  // Browser dev only: ?scan=auto starts a scan as the card opens, for screenshots.
  const auto = useRef(devParam("scan") === "auto");
  useEffect(() => {
    if (!auto.current || !view?.actions.some((a) => a.id === "scan")) return;
    auto.current = false;
    scan.scan();
  });
  if (!view || phase === "gone") return null;
  const remembered = config?.pedal ?? { address: "", name: "" };
  const Icon = ICON[view.tone];

  const act = (a: LinkAction) => {
    if (a.id === "scan") scan.scan();
    else if (a.id === "forget") scan.forget();
    else if (a.id === "bluetooth") openURL(BLUETOOTH_SETTINGS);
    else if (a.id === "connect") scan.run(backend.ChoosePedal(remembered.address, remembered.name));
  };
  const icon = (a: LinkAction) =>
    a.id === "scan" ? (
      <Radar size={12} />
    ) : a.id === "bluetooth" ? (
      <ExternalLink size={12} />
    ) : a.id === "forget" ? (
      <Unplug size={12} />
    ) : undefined;
  const meta = [view.pedal, view.detail].filter(Boolean);

  return (
    <div className="link-overlay">
      <div
        className="link-card"
        data-link-card
        data-phase={phase}
        data-tone={view.tone}
        role="status"
        aria-live="polite"
      >
        <span className="link-card-icon" data-tone={view.tone}>
          <Icon size={16} strokeWidth={1.75} />
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <h2 className="truncate text-ui-lg font-semibold tracking-ui-tight text-bone">
            {view.title}
          </h2>
          {meta.length > 0 && (
            <p className="flex min-w-0 items-center gap-1.5 font-mono text-ui-2xs text-muted">
              {view.pedal && <span className="truncate text-text">{view.pedal}</span>}
              {view.pedal && view.detail && <span className="text-faint">·</span>}
              {view.detail && (
                <span className="link-card-detail truncate tabular-nums">{view.detail}</span>
              )}
            </p>
          )}
          {view.hint && <p className="text-ui-xs leading-snug text-muted">{view.hint}</p>}
          {view.actions.length > 0 && (
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              {view.actions.map((a) => (
                <Button
                  key={a.id}
                  size="sm"
                  kind={a.kind}
                  icon={icon(a)}
                  disabled={a.id === "scan" && scan.scanning}
                  onClick={() => act(a)}
                >
                  {a.id === "scan" && scan.scanning ? "Scanning…" : a.label}
                </Button>
              ))}
            </div>
          )}
          {(scan.scanning || scan.found || scan.err) && (
            <div className="mt-1 flex flex-col gap-2">
              <ScanResults
                scan={scan}
                remembered={remembered.address}
                choose="Choose"
                className="link-card-list"
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
