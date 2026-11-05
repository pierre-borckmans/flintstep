import { Plug, Zap } from "lucide-react";
import type { CSSProperties, ReactNode } from "react";
import { batteryInfo } from "../lib/battery";
import { levelColour } from "../lib/power";
import { PRODUCT_NAME } from "../product";
import type { State } from "../types";
import { cx } from "../ui/cx";
import { Lamp } from "../ui/Lamp";

const DRAG = { "--wails-draggable": "drag" } as CSSProperties;
const NO_DRAG = { "--wails-draggable": "no-drag" } as CSSProperties;

function Connection({ state }: { state: State | null }) {
  const p = state?.pedal;
  const s = p?.state ?? "idle";
  const looking = s === "searching" || s === "connecting";
  const words =
    s === "connected"
      ? p?.name || "Spark Control X"
      : s === "connecting"
        ? "Connecting"
        : s === "searching"
          ? "Searching for pedal"
          : s === "off"
            ? "Bluetooth off"
            : "Not connected";
  // The words in the bar get truncated and drop "Connected to" in a narrow window; the
  // tooltip has the whole state, and which pedal it is once connected.
  const head = p?.detail || words;
  const more =
    s === "connected"
      ? [p?.address, p?.firmware && `Firmware ${p.firmware}`].filter(Boolean).join(" · ")
      : s === "idle"
        ? "Choose a pedal in Settings, under Pedal"
        : s === "off"
          ? "Turn Bluetooth on to connect"
          : "";
  return (
    <div
      className="flex min-w-0 shrink-[3] items-center gap-2"
      title={more ? `${head}\n${more}` : head}
    >
      <span className="relative grid place-items-center">
        <Lamp
          on={s !== "idle"}
          colour={s === "connected" ? "live" : s === "off" ? "hot" : "beam"}
          size={7}
          className={cx(looking && "breathe")}
          style={
            looking ? { animationDuration: s === "connecting" ? "0.8s" : undefined } : undefined
          }
        />
        {looking && (
          <span
            key={s}
            className="lamp-ping"
            style={s === "connecting" ? { animationDuration: "0.8s" } : undefined}
          />
        )}
      </span>
      <span className={cx("truncate text-ui-md", s === "connected" ? "text-text" : "text-muted")}>
        {s === "connected" && <span className="conn-prefix text-muted">Connected to </span>}
        {words}
      </span>
    </div>
  );
}

/** Four cells, like the pedal's own app shows it, coloured like the pedal's POWER lamp
 *  (red, yellow, green by lib/power's thresholds). On
 *  USB a bolt says it is charging, a plug that it is full and running off the cable. */
function Battery({ level, powered, meta }: { level: number; powered: boolean; meta?: string }) {
  if (level < 0) return null;
  const cells = Math.ceil(level / 25);
  const colour = ({ red: "hot", yellow: "warn", green: "live" } as const)[levelColour(level)];
  const { power, tooltip } = batteryInfo(level, powered);
  return (
    <div className="flex items-center gap-1.5" title={meta ? `${tooltip}\n${meta}` : tooltip}>
      {/* A fixed slot, so the cable coming and going does not shift the header. */}
      <span className="grid w-[11px] shrink-0 place-items-center">
        {power === "charging" && (
          <Zap size={11} className="text-live" fill="currentColor" aria-label="Charging" />
        )}
        {power === "usb" && <Plug size={11} className="text-muted" aria-label="On USB power" />}
      </span>
      <div className="flex items-center gap-[2px] rounded-[3px] border border-edge-strong p-[2px]">
        {[0, 1, 2, 3].map((i) => (
          <Lamp
            key={i}
            on={i < cells}
            colour={colour}
            size={5}
            className="!rounded-[1px]"
            style={{ width: 4, boxShadow: "none" }}
          />
        ))}
      </div>
      <span className="min-w-[4ch] text-right font-mono text-ui-sm text-muted tabular-nums">
        {level}%
      </span>
    </div>
  );
}

/** The window's top bar. Left: the app and the link. Middle: what is being edited (the
 *  preset, its save state and history), passed in as children. Right: the pedal's
 *  battery and the MIDI port, compact, with the details in tooltips. The bar drags the
 *  window; everything that takes a click opts out (NO_DRAG). */
export function Header({ state, children }: { state: State | null; children?: ReactNode }) {
  const p = state?.pedal;
  const live = p?.state === "connected";
  const midi = state?.midi;
  const meta = [
    live && p?.firmware ? `fw ${p.firmware}` : "",
    live && p?.profileName ? p.profileName : "",
  ]
    .filter(Boolean)
    .join(" · ");
  // The same, spelled out, under the battery's tooltip (the words above hide first).
  const about = [
    live && p?.firmware ? `Firmware ${p.firmware}` : "",
    live && p?.profileName ? `Profile ${p.profileName}` : "",
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <header style={DRAG} className="app-header">
      <span className="app-wordmark">{PRODUCT_NAME}</span>
      <span className="header-rule h-4 w-px shrink-0 bg-edge-strong" />
      <Connection state={state} />
      <div className="min-w-2 flex-1" />
      {children && (
        <div style={NO_DRAG} className="header-edit flex min-w-0 shrink items-center gap-2">
          {children}
        </div>
      )}
      <span className="header-rule h-4 w-px shrink-0 bg-edge-strong" />
      <div style={NO_DRAG} className="header-device flex shrink-0 items-center gap-3.5">
        {meta && <span className="header-meta truncate text-ui-xs text-faint">{meta}</span>}
        {live && <Battery level={p?.battery ?? -1} powered={!!p?.powered} meta={about} />}
        {midi && (
          <div
            className="flex items-center gap-1.5"
            title={
              midi.ok
                ? `Virtual MIDI ports\nTo your apps: ${midi.source}\nLED feedback from your DAW: ${midi.dest}`
                : `MIDI unavailable\n${midi.error || "The virtual ports could not be created"}`
            }
          >
            <Lamp on colour={midi.ok ? "cold" : "hot"} size={6} />
            <span className={cx("text-ui-sm", midi.ok ? "text-muted" : "text-hot")}>
              MIDI
              <span className="header-midi-port text-text"> {midi.source}</span>
            </span>
          </div>
        )}
      </div>
    </header>
  );
}
