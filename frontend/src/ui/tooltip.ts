// THE TOOLTIPS. One engine for the whole window, adapted from Beam's. It upgrades the
// native `title=""` attributes the components already carry: hover (or keyboard focus)
// a [title] element and, after a short delay, a styled chip with an arrow opens beside
// it instead of the system's yellow box. Call initTooltips() once from main.tsx; no
// component needs to know about it.
//
// Writing one:
//   title="Undo Long press (⌘Z)"         a one-liner: sentence case, no full stop
//   title={"Not saved\nDisk is full"}    a second line after "\n" shows muted, smaller
//   data-kbd="⌘Z"                         key caps after the first line; spaces split caps
//   data-tooltip-side="bottom"            open below (the header does this by itself)
//
// Behaviour:
//   - 450 ms on first hover; once one has shown, the next opens at once if the pointer
//     reaches it within 300 ms (as on macOS).
//   - Keyboard focus opens it only when focus is visible (Tab, arrows), not for a
//     mouse click. Escape or leaving hides it.
//   - A press, a scroll that moves the trigger, a resize or the window losing focus
//     hides it.
//   - It flips and shifts to stay inside the window (ui/tooltipPlacement).
//   - A shown chip follows its trigger's title as it changes (a value under a drag, an
//     undo step), without replaying the fade.
//   - The title is stashed in data-tt while the chip is up and put back after, so it
//     is there for the next hover; meanwhile the trigger is aria-describedby the chip.
//   - Reduced motion: no scale, no fade.
//
// FOR THINGS THAT ARE NOT DOM ELEMENTS (the canvas's switches, lamps and pedals):
//
//   showTooltipAt(rect, text, opts?)   rect: a DOMRect or {x, y, width, height} in
//                                      viewport (client) coordinates. Same text rules.
//     opts.kbd       key caps, as data-kbd
//     opts.side      "top" (default) or "bottom"
//     opts.key       what is being hovered; a call with the same key as the shown (or
//                    pending) tooltip moves/updates it in place instead of restarting
//                    the delay. Defaults to the text. Call it on every pointermove.
//     opts.immediate skip the hover delay
//   hideTooltip()                      hides a tooltip opened by showTooltipAt (DOM
//                                      tooltips run themselves and are left alone).
//
//   e.g. on the canvas's pointermove:
//     const hit = hitTest(e);
//     if (hit) showTooltipAt(hit.screenRect, hit.tooltip, { key: hit.id });
//     else hideTooltip();
//   and hideTooltip() on pointerleave, wheel/zoom and drag start.

import { type Box, placeTooltip, type Side } from "./tooltipPlacement";

const DELAY = 450; // ms before a first tooltip opens
const FOLLOW = 300; // ms after one closes during which the next opens at once

let tip: HTMLDivElement | null = null;
let body: HTMLDivElement | null = null;
let arrow: HTMLDivElement | null = null;
let timer: ReturnType<typeof setTimeout> | undefined;
let shown = false;
let lastClosed = Number.NEGATIVE_INFINITY;

/** What the tooltip is for: a DOM trigger (by hover or by focus), or a showTooltipAt
 *  call. */
type Owner =
  | { kind: "dom"; el: HTMLElement; via: "hover" | "focus"; describedBy: string | null }
  | { kind: "api"; key: string; rect: Box; text: string; kbd?: string; side: Side };
let owner: Owner | null = null;

/** A trigger pressed or Escaped stays quiet until the pointer or focus leaves it. */
let quiet: HTMLElement | null = null;

// A shown tooltip tracks its trigger's title instead of the string it opened with, so a
// value that changes under the pointer (a drag, an undo step being renamed) shows live.
let watcher: MutationObserver | null = null;
let restoring = false; // our own title add/remove must not re-enter the observer

const now = () => performance.now();

function ensure() {
  if (tip) return;
  const style = document.createElement("style");
  // Injected at runtime, so Tailwind never sees it: every colour, radius, size and
  // timing is a var() on style.css's tokens, and both themes restyle it with the app.
  style.textContent = `
.tt{position:fixed;left:0;top:0;z-index:9999;pointer-events:none;
  max-width:min(260px,calc(100vw - 12px));padding:5px 8px;
  border-radius:var(--radius-ui-md);border:1px solid var(--color-edge-strong);
  background:var(--color-panel3);color:var(--color-text);box-shadow:var(--shadow-pop);
  font-size:var(--text-ui-sm);line-height:1.35;font-weight:500;letter-spacing:0;
  text-align:left;white-space:pre-line;overflow-wrap:break-word;
  opacity:0;transform:translateY(var(--tt-dy,2px)) scale(.96);transform-origin:var(--tt-origin,bottom center);
  transition:opacity var(--dur-fast) var(--ease),transform var(--dur-fast) var(--ease);}
.tt.show{opacity:1;transform:none;}
.tt.instant{transition:none;}
.tt-line{display:flex;align-items:baseline;gap:8px;}
.tt-text{min-width:0;}
.tt-sub{margin-top:2px;font-size:var(--text-ui-xs);font-weight:400;color:var(--color-muted);}
.tt-kbd{display:inline-flex;flex-shrink:0;gap:3px;margin-left:auto;}
.tt-kbd kbd{display:inline-grid;place-items:center;min-width:16px;height:16px;padding:0 4px;
  box-sizing:border-box;border:1px solid var(--color-edge-strong);border-bottom-width:2px;
  border-radius:var(--radius-ui-sm);background:var(--color-sunken);color:var(--color-muted);
  font:500 var(--text-ui-2xs)/1 -apple-system,system-ui,sans-serif;}
.tt-arrow{position:absolute;width:8px;height:8px;margin-left:-4px;background:var(--color-panel3);
  border:1px solid var(--color-edge-strong);transform:rotate(45deg);}
.tt[data-side=top] .tt-arrow{bottom:-5px;border-top-color:transparent;border-left-color:transparent;}
.tt[data-side=bottom] .tt-arrow{top:-5px;border-bottom-color:transparent;border-right-color:transparent;}
@media (prefers-reduced-motion: reduce){.tt,.tt.show{transform:none;transition:none!important;}}`;
  document.head.appendChild(style);
  tip = document.createElement("div");
  tip.className = "tt";
  tip.id = "app-tooltip";
  tip.setAttribute("role", "tooltip");
  body = document.createElement("div");
  arrow = document.createElement("div");
  arrow.className = "tt-arrow";
  tip.append(body, arrow);
  document.body.appendChild(tip);
}

/** The chip's content: the first line, its key caps, and the rest muted below. */
function fill(text: string, kbd?: string | null) {
  ensure();
  if (!body) return;
  const nl = text.indexOf("\n");
  const first = nl < 0 ? text : text.slice(0, nl);
  const rest = nl < 0 ? "" : text.slice(nl + 1).trim();
  const line = document.createElement("div");
  line.className = "tt-line";
  const span = document.createElement("span");
  span.className = "tt-text";
  span.textContent = first;
  line.appendChild(span);
  const caps = kbd?.trim().split(/\s+/).filter(Boolean) ?? [];
  if (caps.length) {
    const k = document.createElement("span");
    k.className = "tt-kbd";
    for (const c of caps) {
      const cap = document.createElement("kbd");
      cap.textContent = c;
      k.appendChild(cap);
    }
    line.appendChild(k);
  }
  const nodes: Node[] = [line];
  if (rest) {
    const sub = document.createElement("div");
    sub.className = "tt-sub";
    sub.textContent = rest;
    nodes.push(sub);
  }
  body.replaceChildren(...nodes);
}

/** Where the chip was last placed against, to tell a scroll that moved it. */
let placedAt: Box | null = null;

/** Place the chip against a box. No class changes, so calling it on an open tooltip
 *  moves it in place instead of replaying the fade. */
function place(anchor: Box, prefer: Side) {
  if (!tip || !arrow) return;
  placedAt = { x: anchor.x, y: anchor.y, width: anchor.width, height: anchor.height };
  // Measure at the origin, so the chip wraps at its max width and not at the window's
  // right edge; offsetWidth ignores the open/close scale.
  tip.style.left = "0px";
  tip.style.top = "0px";
  const p = placeTooltip({
    anchor,
    tip: { width: tip.offsetWidth, height: tip.offsetHeight },
    viewport: { width: window.innerWidth, height: window.innerHeight },
    prefer,
  });
  tip.style.left = `${p.x}px`;
  tip.style.top = `${p.y}px`;
  tip.dataset.side = p.side;
  tip.style.setProperty("--tt-origin", `${p.arrowX}px ${p.side === "top" ? "100%" : "0"}`);
  tip.style.setProperty("--tt-dy", p.side === "top" ? "2px" : "-2px");
  arrow.style.left = `${p.arrowX}px`;
}

const sideOf = (el: HTMLElement): Side => {
  const s = el.closest<HTMLElement>("[data-tooltip-side]")?.dataset.tooltipSide;
  if (s === "top" || s === "bottom") return s;
  return el.closest("header") ? "bottom" : "top";
};

/** Repaint the open (or pending) tooltip from its owner. */
function paint() {
  if (!owner) return;
  if (owner.kind === "dom") {
    const el = owner.el;
    fill(el.getAttribute("data-tt") ?? "", el.getAttribute("data-kbd"));
    place(el.getBoundingClientRect(), sideOf(el));
  } else {
    fill(owner.text, owner.kbd);
    place(owner.rect, owner.side);
  }
}

function open(instant: boolean) {
  if (!tip || !owner) return;
  tip.classList.toggle("instant", instant);
  paint();
  if (instant) {
    tip.classList.add("show");
  } else {
    tip.classList.remove("show");
    void tip.offsetWidth; // start the fade from the closed state
    tip.classList.add("show");
  }
  shown = true;
}

/** Open now if a tooltip is up or has just closed, else after the delay. */
function schedule(immediate = false) {
  clearTimeout(timer);
  const warm = shown || now() - lastClosed < FOLLOW;
  if (immediate || warm) {
    open(warm);
    return;
  }
  // Fill it now (hidden), so aria-describedby already reads the text.
  paint();
  timer = setTimeout(() => open(false), DELAY);
}

function watch(el: HTMLElement) {
  watcher?.disconnect();
  watcher = new MutationObserver(() => {
    if (restoring || owner?.kind !== "dom" || owner.el !== el) return;
    const next = el.getAttribute("title");
    if (next != null) {
      restoring = true;
      el.setAttribute("data-tt", next); // re-stash…
      el.removeAttribute("title"); // …and re-suppress the native one
      restoring = false;
    }
    if (shown) paint();
  });
  watcher.observe(el, { attributes: true, attributeFilter: ["title", "data-kbd"] });
}

/** Close whatever is open and give a DOM trigger its title back. */
function close() {
  clearTimeout(timer);
  watcher?.disconnect();
  watcher = null;
  if (owner?.kind === "dom") {
    const el = owner.el;
    const t = el.getAttribute("data-tt");
    restoring = true;
    if (t != null && !el.hasAttribute("title")) el.setAttribute("title", t);
    el.removeAttribute("data-tt");
    if (owner.describedBy) el.setAttribute("aria-describedby", owner.describedBy);
    else el.removeAttribute("aria-describedby");
    restoring = false;
  }
  owner = null;
  if (shown) lastClosed = now();
  shown = false;
  tip?.classList.remove("show");
}

function begin(el: HTMLElement, via: "hover" | "focus") {
  if (owner?.kind === "dom" && owner.el === el) {
    owner.via = via;
    return;
  }
  const title = el.getAttribute("title");
  if (!title || el === quiet) return;
  close(); // a shown one marks lastClosed, so this one opens at once
  ensure();
  owner = { kind: "dom", el, via, describedBy: el.getAttribute("aria-describedby") };
  restoring = true;
  el.setAttribute("data-tt", title); // stash…
  el.removeAttribute("title"); // …and suppress the native tooltip
  el.setAttribute("aria-describedby", tip!.id);
  restoring = false;
  watch(el);
  schedule();
}

/** Show a tooltip for something that is not a DOM element: a box in viewport
 *  coordinates. See the top of this file. */
export function showTooltipAt(
  rect: DOMRect | Box,
  text: string,
  opts: { kbd?: string; side?: Side; key?: string; immediate?: boolean } = {},
) {
  if (!text) {
    hideTooltip();
    return;
  }
  ensure();
  const key = opts.key ?? text;
  const box: Box = { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
  const side = opts.side ?? "top";
  if (owner?.kind === "api" && owner.key === key) {
    owner = { ...owner, rect: box, text, kbd: opts.kbd, side };
    if (shown) paint();
    else if (opts.immediate) schedule(true);
    return;
  }
  close();
  owner = { kind: "api", key, rect: box, text, kbd: opts.kbd, side };
  schedule(opts.immediate);
}

/** Hide a tooltip opened by showTooltipAt. A DOM trigger's tooltip is left alone. */
export function hideTooltip() {
  if (owner?.kind === "api") close();
}

const triggerFrom = (t: EventTarget | null) =>
  t instanceof Element ? t.closest<HTMLElement>("[title], [data-tt]") : null;

let started = false;

/** Wire the global hover and focus listeners. Call once at startup. */
export function initTooltips() {
  if (started || typeof document === "undefined") return;
  started = true;

  document.addEventListener(
    "mouseover",
    (e) => {
      const el = triggerFrom(e.target);
      if (el) begin(el, "hover");
    },
    true,
  );
  document.addEventListener(
    "mouseout",
    (e) => {
      const to = e.relatedTarget as Node | null;
      if (quiet && !(to && quiet.contains(to))) quiet = null;
      if (owner?.kind !== "dom" || owner.via !== "hover") return;
      if (to && owner.el.contains(to)) return; // moved to a child: keep it
      close();
    },
    true,
  );
  // A press hides it, and the trigger stays quiet until the pointer leaves it.
  const press = () => {
    if (owner?.kind === "dom") quiet = owner.el;
    close();
  };
  // pointerdown as well: a scrub field cancels the mousedown that would follow.
  document.addEventListener("pointerdown", press, true);
  document.addEventListener("mousedown", press, true);
  // A scroll that moves the trigger hides it; one elsewhere (a log filling up) does not.
  window.addEventListener(
    "scroll",
    () => {
      if (owner?.kind === "dom" && placedAt) {
        const r = owner.el.getBoundingClientRect();
        if (r.x === placedAt.x && r.y === placedAt.y) return;
      }
      close();
    },
    true,
  );
  // Only a real change of size: some resize events leave the window as it was.
  let size = `${window.innerWidth}x${window.innerHeight}`;
  window.addEventListener("resize", () => {
    const next = `${window.innerWidth}x${window.innerHeight}`;
    if (next === size) return;
    size = next;
    close();
  });
  window.addEventListener("blur", () => close());

  document.addEventListener("focusin", (e) => {
    const t = e.target;
    // Only a focus the user should see: Tab and arrow keys, not a mouse click.
    if (!(t instanceof HTMLElement) || !t.matches(":focus-visible")) return;
    const el = triggerFrom(t);
    if (el) begin(el, "focus");
  });
  document.addEventListener("focusout", (e) => {
    if (quiet?.contains(e.target as Node)) quiet = null;
    if (owner?.kind === "dom" && owner.via === "focus") close();
  });
  document.addEventListener(
    "keydown",
    (e) => {
      if (e.key !== "Escape" || !owner) return;
      if (owner.kind === "dom") quiet = owner.el;
      close();
    },
    true,
  );
}
