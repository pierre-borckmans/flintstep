import { type CSSProperties, type ReactNode, useId, useRef } from "react";
import { cx } from "./cx";
import { useIndicator } from "./useIndicator";

export interface TabDef<T extends string> {
  id: T;
  label: string;
  /** A tooltip saying what is in the tab. */
  title?: string;
}

const tabId = (base: string, id: string) => `${base}-tab-${id}`;
const panelId = (base: string, id: string) => `${base}-panel-${id}`;

/** A row of tabs with one brass underline that slides to the chosen tab and takes its
 *  width. ←/→ (and Home/End) move and choose, as a tablist does. Pair it with TabPanel
 *  using the same `base`. */
export function Tabs<T extends string>({
  tabs,
  value,
  onChange,
  label,
  base,
  className,
}: {
  tabs: TabDef<T>[];
  value: T;
  onChange: (t: T) => void;
  label: string;
  /** Shared with TabPanel to link tabs and panels (useTabsId()). */
  base: string;
  className?: string;
}) {
  const box = useRef<HTMLDivElement>(null);
  const line = useIndicator(box, '[aria-selected="true"]', [value, tabs.length]);
  const index = tabs.findIndex((t) => t.id === value);

  const onKey = (e: React.KeyboardEvent) => {
    let i = -1;
    if (e.key === "ArrowRight") i = (index + 1) % tabs.length;
    else if (e.key === "ArrowLeft") i = (index - 1 + tabs.length) % tabs.length;
    else if (e.key === "Home") i = 0;
    else if (e.key === "End") i = tabs.length - 1;
    if (i < 0) return;
    e.preventDefault();
    onChange(tabs[i].id);
    document.getElementById(tabId(base, tabs[i].id))?.focus();
  };

  return (
    <div
      ref={box}
      role="tablist"
      aria-label={label}
      onKeyDown={onKey}
      className={cx("tabs relative", className)}
    >
      {tabs.map((t) => {
        const on = t.id === value;
        return (
          <button
            key={t.id}
            id={tabId(base, t.id)}
            type="button"
            role="tab"
            aria-selected={on}
            aria-controls={panelId(base, t.id)}
            title={t.title}
            tabIndex={on ? 0 : -1}
            onClick={() => onChange(t.id)}
            className={cx("tab", on && "is-active")}
          >
            {t.label}
          </button>
        );
      })}
      <span
        aria-hidden
        data-ready={line.ready}
        className="tab-line slide-indicator"
        style={line.style}
      />
    </div>
  );
}

export const useTabsId = () => useId().replace(/:/g, "");

/** The panel for tab `id`. It slides in from the side of the tab it replaces: `from` is
 *  the previous tab's index relative to this one (negative: it was to the left). */
export function TabPanel({
  base,
  id,
  from,
  className,
  children,
}: {
  base: string;
  id: string;
  from: number;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      key={id}
      id={panelId(base, id)}
      role="tabpanel"
      aria-labelledby={tabId(base, id)}
      className={cx("tab-panel", className)}
      style={{ "--panel-from": `${Math.sign(from) * -10}px` } as CSSProperties}
    >
      {children}
    </div>
  );
}
