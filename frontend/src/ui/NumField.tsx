import { useEffect, useRef, useState } from "react";
import {
  clampStep,
  fraction,
  type Gesture,
  keyValue,
  nextGesture,
  parseValue,
  type Range,
  SCRUB_THRESHOLD,
  scrubValue,
  travel,
  wheelSteps,
} from "../lib/scrub";
import { cx } from "./cx";

/** A number you can drag, like a scrub field in a DAW. Press anywhere on it and drag
 *  sideways (or up) to change it: a step per 4 px, Shift for fine (12 px), Alt for ten
 *  at a time; the pointer is locked while dragging where the browser allows it. A click
 *  types: Enter or leaving keeps it, Esc puts it back, text that is not a value reverts.
 *  Focused, ↑/↓ step (Shift ten), PageUp/PageDown ten, Home/End the ends, and the wheel
 *  steps; unfocused the wheel scrolls the page as usual.
 *
 *  `parse` reads another unit when typed (note names) and `format` shows the value;
 *  `suffix` is a second, quieter reading after it (the note name, a unit). A drag passes
 *  its Gesture with each value, so the bridge keeps it as one edit and one save. */
export function NumField({
  value,
  onChange,
  min,
  max,
  step = 1,
  label,
  parse,
  format,
  suffix,
  className,
  disabled,
  wide,
}: {
  value: number;
  onChange: (v: number, gesture?: Gesture) => void;
  min: number;
  max: number;
  step?: number;
  label: string;
  parse?: (s: string) => number | null;
  format?: (v: number) => string;
  suffix?: string;
  className?: string;
  disabled?: boolean;
  wide?: boolean;
}) {
  const range: Range = { min, max, step };
  const show = format ?? String;
  const box = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState("");
  const [scrubbing, setScrubbing] = useState(false);
  const selectAll = useRef(true);
  const drag = useRef<{
    id: number;
    x: number;
    y: number;
    start: number;
    px: number;
    last: number;
    moved: boolean;
    fine: boolean;
    coarse: boolean;
    gesture: number;
  } | null>(null);
  const latest = useRef({ value, onChange, range, disabled, editing, show });
  latest.current = { value, onChange, range, disabled, editing, show };

  const edit = (initial: string, select: boolean) => {
    ended.current = false;
    selectAll.current = select;
    setText(initial);
    setEditing(true);
  };
  /** Set once Enter or Esc has ended the edit, so the blur that follows (focus going
   *  back to the field) does not end it again with the old text. */
  const ended = useRef(false);
  const stopEditing = (keep: boolean) => {
    if (ended.current) return;
    ended.current = true;
    if (keep) {
      const v = parseValue(text, range, parse);
      if (v !== null && v !== value) onChange(v);
    }
    setEditing(false);
  };

  useEffect(() => {
    if (!editing) return;
    const el = input.current;
    el?.focus();
    if (selectAll.current) el?.select();
    else el?.setSelectionRange(el.value.length, el.value.length);
  }, [editing]);

  // The wheel steps a focused field. Non-passive, so it can keep the page still.
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    let acc = 0;
    const onWheel = (e: WheelEvent) => {
      const l = latest.current;
      if (l.disabled || !el.contains(document.activeElement)) return;
      e.preventDefault();
      const px = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
      const [n, rest] = wheelSteps(acc, px);
      acc = rest;
      if (!n) return;
      const v = clampStep(l.value + n * (l.range.step ?? 1), l.range);
      if (v === l.value) return;
      l.onChange(v);
      if (l.editing) setText(l.show(v));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  const finish = (click: boolean) => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    if (document.pointerLockElement === box.current) document.exitPointerLock?.();
    if (d.moved) {
      setScrubbing(false);
      onChange(d.last, { id: d.gesture, done: true });
    } else if (click) edit(show(value), true);
  };

  const pct = fraction(value, range) * 100;
  const valueText = suffix ? `${show(value)} ${suffix}` : show(value);

  return (
    <div
      ref={box}
      role="spinbutton"
      tabIndex={disabled || editing ? -1 : 0}
      aria-label={label}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={value}
      aria-valuetext={valueText}
      aria-disabled={disabled || undefined}
      data-scrubbing={scrubbing || undefined}
      data-editing={editing || undefined}
      title={disabled || editing ? undefined : "Drag to change · click to type"}
      onPointerDown={(e) => {
        if (disabled || editing || e.button !== 0) return;
        e.preventDefault(); // no text selection; focus by hand, without scrolling
        // Focus from the mouse: no focus ring (Tab still shows it).
        e.currentTarget.dataset.pointer = "";
        box.current?.focus({ preventScroll: true });
        e.currentTarget.setPointerCapture(e.pointerId);
        drag.current = {
          id: e.pointerId,
          x: e.clientX,
          y: e.clientY,
          start: value,
          px: 0,
          last: value,
          moved: false,
          fine: e.shiftKey,
          coarse: e.altKey,
          gesture: 0,
        };
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (!d || d.id !== e.pointerId) return;
        const locked = document.pointerLockElement === box.current;
        // Locked, the pointer stays put and only reports movement.
        const dx = locked ? e.movementX : e.clientX - d.x;
        const dy = locked ? e.movementY : e.clientY - d.y;
        if (!locked) {
          d.x = e.clientX;
          d.y = e.clientY;
        }
        d.px += travel(dx, dy);
        if (!d.moved) {
          if (Math.abs(d.px) < SCRUB_THRESHOLD) return;
          d.moved = true;
          d.gesture = nextGesture();
          setScrubbing(true);
          try {
            // A promise in Chrome, nothing in older WebKit; WKWebView may refuse it.
            const p = box.current?.requestPointerLock?.() as unknown as Promise<void> | undefined;
            p?.catch?.(() => {});
          } catch {
            // No lock: the drag still works, it just stops at the screen's edge.
          }
        }
        // A modifier pressed or let go mid-drag carries on from here at the new rate.
        if (e.shiftKey !== d.fine || e.altKey !== d.coarse) {
          d.start = d.last;
          d.px = 0;
          d.fine = e.shiftKey;
          d.coarse = e.altKey;
        }
        const v = scrubValue(d.start, d.px, range, { fine: d.fine, coarse: d.coarse });
        if (v !== d.last) {
          d.last = v;
          onChange(v, { id: d.gesture, done: false });
        }
      }}
      onPointerUp={(e) => drag.current?.id === e.pointerId && finish(true)}
      onPointerCancel={() => finish(false)}
      onLostPointerCapture={() => {
        // Pointer lock can take the capture away from a drag; it carries on until
        // pointerup, which the locked field still gets.
        if (!drag.current?.moved) finish(false);
      }}
      onBlur={(e) => {
        delete e.currentTarget.dataset.pointer;
      }}
      onKeyDown={(e) => {
        if (disabled || editing) return;
        const v = keyValue(e.key, value, range, { shift: e.shiftKey });
        if (v !== null) {
          e.preventDefault();
          if (v !== value) onChange(v);
        } else if (e.key === "Enter" || e.key === "F2") {
          e.preventDefault();
          edit(show(value), true);
        } else if (e.key.length === 1 && !e.metaKey && !e.ctrlKey && /[\w#-]/.test(e.key)) {
          // Typing starts editing with what was typed.
          e.preventDefault();
          edit(e.key, false);
        }
      }}
      className={cx(
        "numfield group relative flex h-9 items-center gap-1.5 overflow-hidden rounded-ui-sm border bg-sunken px-2 shadow-[inset_0_1px_2px_rgb(0_0_0/0.5)]",
        "transition-[border-color,background-image] duration-(--dur) ease-(--ease)",
        disabled
          ? "opacity-40"
          : editing
            ? "border-edge-strong"
            : "cursor-ew-resize border-edge hover:border-edge-strong hover:warm focus-visible:border-edge-strong data-scrubbing:border-cold/50",
        className,
      )}
    >
      <span className="pointer-events-none text-ui-2xs font-semibold uppercase tracking-kicker text-faint">
        {label}
      </span>
      {editing ? (
        <input
          ref={input}
          type="text"
          inputMode="numeric"
          aria-label={label}
          aria-invalid={parseValue(text, range, parse) === null}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={() => stopEditing(true)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              stopEditing(true);
              box.current?.focus({ preventScroll: true });
            } else if (e.key === "Escape") {
              e.preventDefault();
              e.stopPropagation();
              stopEditing(false);
              box.current?.focus({ preventScroll: true });
            }
          }}
          style={{ outline: "none" }}
          className={cx(
            "min-w-0 flex-1 bg-transparent text-right font-mono text-ui-md text-bone tabular-nums outline-none",
            parseValue(text, range, parse) === null && "text-hot",
            wide ? "w-14" : "w-8",
          )}
        />
      ) : (
        <span
          className={cx(
            "pointer-events-none min-w-0 flex-1 truncate text-right font-mono text-ui-md tabular-nums",
            scrubbing ? "text-key" : "text-bone",
          )}
        >
          {show(value)}
        </span>
      )}
      {suffix && (
        <span className="pointer-events-none font-mono text-ui-xs text-muted tabular-nums">
          {suffix}
        </span>
      )}
      {/* Where the value sits in its range: data, so it moves like an LED. */}
      <span
        aria-hidden
        className={cx(
          "pointer-events-none absolute bottom-0 left-0 h-px bg-cold transition-[width,opacity] duration-(--dur-led) ease-(--ease-led)",
          scrubbing ? "opacity-90" : "opacity-35 group-hover:opacity-60",
        )}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}
