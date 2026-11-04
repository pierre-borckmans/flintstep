import { useState } from "react";
import type { Backend } from "./api";
import { ActivityLog } from "./components/Activity";
import { ExpressionPanel } from "./components/ExpressionPanel";
import { Header } from "./components/Header";
import { Pedal } from "./components/Pedal";
import { SaveBar } from "./components/SaveBar";
import { SettingsPanel } from "./components/SettingsPanel";
import { SwitchEditor } from "./components/SwitchEditor";
import { cx } from "./ui/cx";
import { useBridge } from "./useBridge";

type Tab = "switches" | "expression" | "settings";
const TABS: { id: Tab; label: string }[] = [
  { id: "switches", label: "Switches" },
  { id: "expression", label: "Expression" },
  { id: "settings", label: "Settings" },
];

const q = new URLSearchParams(window.location.search);

export default function App({ backend }: { backend: Backend }) {
  const bridge = useBridge(backend);
  const { state, config, apply } = bridge;
  const [sel, setSel] = useState(() => Math.max(0, Number(q.get("sel") ?? 0)) % 6);
  const [tab, setTab] = useState<Tab>(() => (q.get("tab") as Tab) || "switches");
  const status = state?.pedal ?? null;
  const live = status?.state === "connected";

  const select = (n: number) => {
    setSel(n);
    setTab("switches");
  };

  return (
    <div className="flex h-full flex-col">
      <Header state={state} />
      <main className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_minmax(320px,360px)] gap-3 p-3">
        <div className="flex min-h-0 min-w-0 flex-col gap-3">
          <Pedal status={status} config={config} selected={sel} onSelect={select} />
          <p className="-mt-1 text-center text-ui-xs text-faint">
            {live
              ? "Click a switch to edit it. Pressing it on the pedal lights it here too."
              : status?.detail || "Waiting for the app"}
          </p>
          <ActivityLog log={bridge.log} midi={state?.midi ?? null} />
        </div>

        <aside className="flex min-h-0 flex-col overflow-hidden rounded-ui-lg border border-edge bg-panel shadow-card">
          <nav className="flex h-10 shrink-0 items-center gap-1 border-b border-edge px-2">
            {TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                aria-current={tab === t.id ? "page" : undefined}
                className={cx(
                  "h-7 flex-1 rounded-ui-sm text-ui-sm font-semibold transition-[color,box-shadow,background-color] duration-(--dur) ease-(--ease)",
                  tab === t.id
                    ? "lit bg-panel3 text-bone"
                    : "text-muted hover:warm hover:text-text",
                )}
              >
                {t.label}
              </button>
            ))}
          </nav>
          <div className="scroll-y min-h-0 flex-1">
            {!config || !state ? (
              <p className="p-4 text-ui-sm text-faint">Loading…</p>
            ) : tab === "switches" ? (
              <SwitchEditor config={config} sw={sel} onSelect={setSel} apply={apply} />
            ) : tab === "expression" ? (
              <ExpressionPanel
                config={config}
                status={status}
                apply={apply}
                calibrate={bridge.calibrate}
              />
            ) : (
              <SettingsPanel
                backend={backend}
                state={state}
                config={config}
                apply={apply}
                reset={bridge.reset}
              />
            )}
          </div>
          <SaveBar bridge={bridge} />
        </aside>
      </main>
    </div>
  );
}
