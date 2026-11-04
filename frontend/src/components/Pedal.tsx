import type { CSSProperties } from "react";
import { actionCaption, longCaption } from "../lib/caption";
import { isDark, lampLight, rgb } from "../lib/colour";
import type { Colour, Config, Status } from "../types";
import { LAMP_AMP, LAMP_APP, SWITCH_NAMES } from "../types";
import { cx } from "../ui/cx";
import { UNLIT } from "../ui/Lamp";

// THE PEDAL, TOP-DOWN. Drawn in CSS: a dark enclosure, six footswitches in two rows
// (I II A over III IV B), each sitting in an RGB LED ring that shows exactly what
// status.lamps says the hardware is showing. The jacks are on the back edge, which is the
// top of this view, so a plugged expression pedal's cable leaves upward.

const ORDER = [0, 1, 2, 3, 4, 5]; // grid order: the bit order already is top row, then bottom

/** A lamp whose colour comes from the hardware, not from the app's palette. */
export function RgbLamp({ colour, size = 6 }: { colour: Colour | undefined; size?: number }) {
  const { colour: c, level } = lampLight(colour ?? { r: 0, g: 0, b: 0 });
  const on = level > 0;
  return (
    <span
      aria-hidden
      className="inline-block shrink-0 rounded-full"
      style={{
        width: size,
        height: size,
        background: on
          ? `radial-gradient(circle at 38% 30%, ${rgb({ r: 255, g: 255, b: 255 }, 0.8)}, ${rgb(c)} 70%)`
          : UNLIT,
        boxShadow: on
          ? `0 0 6px ${rgb(c, 0.9 * level)}, 0 0 14px ${rgb(c, 0.45 * level)}`
          : "inset 0 1px 0 rgb(255 244 228 / 0.06)",
        opacity: on ? 0.35 + 0.65 * level : 1,
        transition: "all var(--dur-led) var(--ease-led)",
      }}
    />
  );
}

function Jack({ n, cable }: { n: number; cable: boolean }) {
  return (
    <div className="relative flex flex-col items-center gap-1">
      {/* the cable, leaving the back of the pedal */}
      <svg
        aria-hidden
        className="absolute bottom-[12px] left-1/2 -translate-x-1/2 overflow-visible"
        width="24"
        height="54"
        style={{ opacity: cable ? 1 : 0, transition: "opacity var(--dur-up) var(--ease-incand)" }}
      >
        <defs>
          <linearGradient id={`cable-fade-${n}`} x1="0" y1="1" x2="0" y2="0">
            <stop offset="0" stopColor="#2a2f34" />
            <stop offset="0.5" stopColor="#1a1d20" />
            <stop offset="1" stopColor="#1a1d20" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path
          d={n === 0 ? "M12 54 C12 30, 6 16, -14 -2" : "M12 54 C12 30, 18 16, 38 -2"}
          stroke={`url(#cable-fade-${n})`}
          strokeWidth="5.5"
          strokeLinecap="round"
          fill="none"
        />
        <rect x="6.5" y="36" width="11" height="17" rx="3" fill="#1b1e21" stroke="#41484e" />
        <rect x="7.5" y="49" width="9" height="3" rx="1" fill="#6b737a" />
      </svg>
      <span
        className="relative block h-[11px] w-[11px] rounded-full"
        style={{
          background: "radial-gradient(circle, #050607 0 38%, #6b737a 42%, #3a4046 70%, #262a2e)",
          boxShadow: "0 1px 0 rgb(255 244 228 / 0.08), inset 0 1px 1px rgb(0 0 0 / 0.6)",
        }}
      />
      <span
        className={cx(
          "text-[8px] font-semibold tracking-kicker engraved",
          cable ? "text-muted" : "text-faint",
        )}
      >
        EXP {n + 1}
      </span>
    </div>
  );
}

function FootSwitch({
  index,
  lamp,
  held,
  selected,
  config,
  onSelect,
}: {
  index: number;
  lamp: Colour | undefined;
  held: boolean;
  selected: boolean;
  config: Config | null;
  onSelect: (n: number) => void;
}) {
  const { colour: c, level } = lampLight(lamp ?? { r: 0, g: 0, b: 0 });
  const lit = !isDark(lamp);
  const sw = config?.switches[index];
  const cap = sw ? actionCaption(sw.tap) : "";
  const capShort = sw ? actionCaption(sw.tap, true) : "";
  const hold = sw ? longCaption(sw.long) : "";
  const holdShort = sw ? longCaption(sw.long, true) : "";
  const a = 0.25 + 0.75 * level; // perceived intensity of a dimmed LED

  const ring: CSSProperties = lit
    ? {
        borderColor: rgb(c, 0.55 + 0.45 * level),
        boxShadow: `0 0 6px 1px ${rgb(c, 0.75 * a)}, 0 0 22px 4px ${rgb(c, 0.4 * a)}, inset 0 0 8px ${rgb(c, 0.6 * a)}`,
      }
    : {
        borderColor: "#2a2f34",
        boxShadow: "inset 0 1px 2px rgb(0 0 0 / 0.7), 0 1px 0 rgb(255 244 228 / 0.06)",
      };

  return (
    <button
      type="button"
      onClick={() => onSelect(index)}
      aria-pressed={selected}
      aria-label={`Switch ${SWITCH_NAMES[index]}: ${cap}`}
      className="group flex min-w-0 flex-col items-center gap-1.5 rounded-ui-lg px-1 pt-1 pb-1.5 outline-none focus-visible:outline-1"
    >
      <span
        className={cx(
          "text-ui-sm font-bold tracking-[0.06em] engraved transition-colors duration-(--dur)",
          selected ? "text-beam" : "text-bone/80 group-hover:text-bone",
        )}
        style={selected ? { textShadow: "0 0 10px rgb(255 180 84 / 0.5)" } : undefined}
      >
        {SWITCH_NAMES[index]}
      </span>
      <span className="relative block" style={{ width: "var(--sw)", height: "var(--sw)" }}>
        {/* light spilling onto the enclosure around a lit ring */}
        <span
          aria-hidden
          className="pointer-events-none absolute -inset-[45%] rounded-full"
          style={{
            background: `radial-gradient(closest-side, ${rgb(c, 0.22 * a)}, ${rgb(c, 0)})`,
            opacity: lit ? 1 : 0,
            transition: "opacity var(--dur-led) var(--ease-led)",
          }}
        />
        {/* selection: the key light catching a rim around the switch */}
        <span
          aria-hidden
          className="pointer-events-none absolute -inset-[7px] rounded-full border transition-[opacity,border-color] duration-(--dur-up) ease-(--ease-incand)"
          style={{
            borderColor: selected ? "rgb(255 180 84 / 0.7)" : "rgb(255 244 228 / 0.08)",
            boxShadow: selected ? "0 0 12px rgb(255 180 84 / 0.25)" : "none",
            opacity: selected ? 1 : 0,
          }}
        />
        <span
          aria-hidden
          className="pointer-events-none absolute -inset-[7px] rounded-full border border-key/10 opacity-0 transition-opacity duration-(--dur) group-hover:opacity-100"
          style={{ display: selected ? "none" : undefined }}
        />
        {/* the LED ring */}
        <span
          className="absolute inset-0 rounded-full border-[3px]"
          style={{
            background: "radial-gradient(circle, #0b0c0e 60%, #16191c)",
            transition:
              "border-color var(--dur-led) var(--ease-led), box-shadow var(--dur-led) var(--ease-led)",
            ...ring,
          }}
        />
        {/* the cap: a metal footswitch, sinking when held */}
        <span
          className="absolute inset-[15%] rounded-full"
          style={{
            background: held
              ? "radial-gradient(circle at 40% 34%, #5a6168, #353a3f 55%, #1e2226)"
              : "radial-gradient(circle at 36% 28%, #8a929a, #4d545b 52%, #2a2f34)",
            boxShadow: held
              ? "0 0 0 1px rgb(0 0 0 / 0.6), 0 1px 1px rgb(0 0 0 / 0.7), inset 0 1px 3px rgb(0 0 0 / 0.5)"
              : "0 0 0 1px rgb(0 0 0 / 0.55), 0 4px 6px rgb(0 0 0 / 0.65), inset 0 1px 0 rgb(255 255 255 / 0.22)",
            transform: held ? "translateY(1px) scale(0.93)" : "none",
            transition:
              "transform var(--dur-fast) var(--ease), background var(--dur-fast), box-shadow var(--dur-fast)",
          }}
        >
          <span
            className="absolute inset-[18%] rounded-full"
            style={{
              background:
                "repeating-conic-gradient(rgb(255 255 255 / 0.05) 0 6deg, rgb(0 0 0 / 0.06) 6deg 12deg)",
              boxShadow: "inset 0 1px 1px rgb(0 0 0 / 0.35), 0 1px 0 rgb(255 255 255 / 0.08)",
            }}
          />
        </span>
      </span>
      <span className="flex w-full min-w-0 flex-col items-center leading-tight">
        <span
          className={cx(
            "max-w-full truncate text-ui-xs transition-colors duration-(--dur)",
            selected ? "text-text" : "text-muted",
          )}
        >
          <span className="@max-md:hidden">{cap}</span>
          <span className="hidden @max-md:inline">{capShort}</span>
        </span>
        <span className="h-3 max-w-full truncate text-ui-2xs text-faint">
          <span className="@max-md:hidden">{hold}</span>
          <span className="hidden @max-md:inline">{holdShort}</span>
        </span>
      </span>
    </button>
  );
}

export function Pedal({
  status,
  config,
  selected,
  onSelect,
}: {
  status: Status | null;
  config: Config | null;
  selected: number;
  onSelect: (n: number) => void;
}) {
  const live = status?.state === "connected";
  const lamps = status?.lamps ?? [];
  const held = status?.held ?? 0;
  return (
    <div className="@container relative flex justify-center px-2 pt-7 pb-1">
      <div
        className="relative w-full max-w-[540px] rounded-[22px] px-[4cqw] pt-3 pb-3"
        style={
          {
            "--sw": "clamp(44px, 11.2cqw, 62px)",
            background: "linear-gradient(180deg, #2b3035 0%, #1e2226 38%, #16191c 100%)",
            boxShadow:
              "var(--shadow-contact), var(--shadow-cast), inset 0 1px 0 rgb(255 244 228 / 0.13), inset 0 -2px 0 rgb(0 0 0 / 0.45), 0 0 0 1px #0c0d0f",
          } as CSSProperties
        }
      >
        {(["top-2 left-2", "top-2 right-2", "bottom-2 left-2", "bottom-2 right-2"] as const).map(
          (pos) => (
            <span
              key={pos}
              aria-hidden
              className={cx("absolute h-[7px] w-[7px] rounded-full", pos)}
              style={{
                background:
                  "linear-gradient(135deg, transparent 42%, #0d0f11 42% 58%, transparent 58%), radial-gradient(circle at 35% 30%, #5a6168, #2a2f34)",
                boxShadow: "0 1px 0 rgb(255 244 228 / 0.08), inset 0 0 1px rgb(0 0 0 / 0.8)",
              }}
            />
          ),
        )}
        {/* the back edge: jacks, wordmark, Amp/App lamps */}
        <div className="flex items-end justify-between px-3 pb-2">
          <div className="flex gap-4">
            <Jack n={0} cable={!!status?.cables?.[0]} />
            <Jack n={1} cable={!!status?.cables?.[1]} />
          </div>
          <span className="truncate px-2 pb-[3px] text-[9px] font-bold tracking-[0.32em] text-bone/45 engraved @max-md:text-[8px] @max-md:tracking-[0.18em]">
            SPARK CONTROL X
          </span>
          <div className="flex gap-3 pb-[2px]">
            {(
              [
                ["AMP", LAMP_AMP],
                ["APP", LAMP_APP],
              ] as const
            ).map(([label, n]) => (
              <span key={label} className="flex items-center gap-1.5">
                <RgbLamp colour={lamps[n]} size={5} />
                <span className="text-[8px] font-semibold tracking-kicker text-faint engraved">
                  {label}
                </span>
              </span>
            ))}
          </div>
        </div>
        {/* the deck the switches sit in */}
        <div
          className={cx(
            "grid grid-cols-3 gap-x-[2cqw] gap-y-1 rounded-[14px] px-[2cqw] pt-2 pb-1",
            !live && "[filter:var(--off-dim)]",
          )}
          style={{
            background: "linear-gradient(180deg, #15181b, #121417)",
            boxShadow: "inset 0 1px 3px rgb(0 0 0 / 0.65), 0 1px 0 rgb(255 244 228 / 0.06)",
            transition: "filter var(--dur-down) var(--ease-incand)",
          }}
        >
          {ORDER.map((n) => (
            <FootSwitch
              key={n}
              index={n}
              lamp={lamps[n]}
              held={(held & (1 << n)) !== 0}
              selected={selected === n}
              config={config}
              onSelect={onSelect}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
