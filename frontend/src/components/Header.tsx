import { Plug, Zap } from "lucide-react";
import type { CSSProperties } from "react";
import { batteryInfo } from "../lib/battery";
import type { State } from "../types";
import { cx } from "../ui/cx";
import { Lamp } from "../ui/Lamp";

const DRAG = { "--wails-draggable": "drag" } as CSSProperties;

function Connection({ state }: { state: State | null }) {
  const p = state?.pedal;
  const s = p?.state ?? "idle";
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
  return (
    <div className="flex min-w-0 items-center gap-2" title={p?.detail}>
      <Lamp
        on={s !== "idle"}
        colour={s === "connected" ? "live" : s === "off" ? "hot" : "beam"}
        size={7}
        className={cx((s === "searching" || s === "connecting") && "breathe")}
      />
      <span className={cx("truncate text-ui-md", s === "connected" ? "text-text" : "text-muted")}>
        {s === "connected" && <span className="text-muted">Connected to </span>}
        {words}
      </span>
    </div>
  );
}

/** Four cells, like the pedal's own app shows it. Mid charge is warm, low is hot. On
 *  USB a bolt says it is charging, a plug that it is full and running off the cable. */
function Battery({ level, powered }: { level: number; powered: boolean }) {
  if (level < 0) return null;
  const cells = Math.ceil(level / 25);
  const colour = level <= 15 ? "hot" : level <= 35 ? "warn" : "live";
  const { power, tooltip } = batteryInfo(level, powered);
  return (
    <div className="flex items-center gap-1.5" title={tooltip}>
      {power === "charging" && (
        <Zap size={11} className="text-live" fill="currentColor" aria-label="Charging" />
      )}
      {power === "usb" && <Plug size={11} className="text-muted" aria-label="On USB power" />}
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
      <span className="font-mono text-ui-sm text-muted tabular-nums">{level}%</span>
    </div>
  );
}

export function Header({ state }: { state: State | null }) {
  const p = state?.pedal;
  const live = p?.state === "connected";
  const midi = state?.midi;
  const meta = [
    live && p?.firmware ? `fw ${p.firmware}` : "",
    live && p?.profileName ? p.profileName : "",
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <header
      style={DRAG}
      className="relative flex h-11 shrink-0 items-center gap-4 border-b border-edge pr-4 pl-[84px]"
    >
      <span className="text-ui-base font-semibold tracking-ui-tight text-bone engraved">
        SparkX <span className="text-muted">MIDI</span>
      </span>
      <span className="h-4 w-px bg-edge-strong" />
      <Connection state={state} />
      <div className="flex-1" />
      {meta && <span className="truncate text-ui-sm text-muted">{meta}</span>}
      {live && <Battery level={p?.battery ?? -1} powered={!!p?.powered} />}
      {midi && (
        <div
          className="flex max-w-[260px] min-w-0 items-center gap-2"
          title={midi.ok ? `Virtual MIDI: ${midi.source} → / ← ${midi.dest}` : midi.error}
        >
          <Lamp on colour={midi.ok ? "cold" : "hot"} size={6} />
          <span className={cx("truncate text-ui-sm", midi.ok ? "text-muted" : "text-hot")}>
            {midi.ok ? (
              <>
                MIDI <span className="text-text">{midi.source}</span>
              </>
            ) : (
              `MIDI: ${midi.error || "unavailable"}`
            )}
          </span>
        </div>
      )}
    </header>
  );
}
