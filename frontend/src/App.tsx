import { type CSSProperties, useEffect, useRef, useState } from "react";
import type { Backend } from "./api";
import { ActivityLog } from "./components/Activity";
import { ExpressionPanel } from "./components/ExpressionPanel";
import { useSimControls } from "./components/ExpSim";
import { Header } from "./components/Header";
import { HistoryControls } from "./components/HistoryControls";
import { IndicatorEditor } from "./components/IndicatorEditor";
import { PedalViewer } from "./components/PedalViewer";
import { type PickerStart, PresetPicker } from "./components/PresetPicker";
import { SettingsPanel } from "./components/SettingsPanel";
import { SwitchEditor, SwitchTabs } from "./components/SwitchEditor";
import { readViewPreference, saveViewPreference } from "./lib/view";
import { STORAGE_PREFIX } from "./product";
import type { IndicatorIndex } from "./types";
import { TabPanel, Tabs, useTabsId } from "./ui/Tabs";
import { useBridge } from "./useBridge";

const SPLIT_KEY = `${STORAGE_PREFIX}viewer.split`;

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
  const sim = useSimControls(backend, state);
  // What is selected on the canvas: a switch, an indicator lamp (Amp 0, App 1) or an
  // expression pedal, only ever one. `sel` remembers the last switch for the Switches
  // tab. ?sel=N|exp1|exp2 and ?lamp=amp|app open on one, for screenshots.
  const expQ = q.get("sel")?.match(/^exp([12])$/);
  const [sel, setSel] = useState(() =>
    expQ ? 0 : Math.max(0, Number(q.get("sel") ?? 0) || 0) % 6,
  );
  const [ind, setInd] = useState<IndicatorIndex | null>(() =>
    q.get("lamp") === "amp" ? 0 : q.get("lamp") === "app" ? 1 : null,
  );
  const [exp, setExp] = useState<0 | 1 | null>(() => (expQ ? (expQ[1] === "1" ? 0 : 1) : null));
  const [tab, setTabNow] = useState<Tab>(
    () => (q.get("tab") as Tab) || (expQ ? "expression" : "switches"),
  );
  // Which way the panels slide: the previous tab's place relative to the new one.
  const [tabFrom, setTabFrom] = useState(0);
  const setTab = (t: Tab) => {
    const at = (x: Tab) => TABS.findIndex((d) => d.id === x);
    if (t !== tab) setTabFrom(at(tab) - at(t));
    setTabNow(t);
  };
  const tabsId = useTabsId();
  const status = state?.pedal ?? null;
  const [split, setSplit] = useState(() => readViewPreference(SPLIT_KEY, 72, 40, 82));
  const workspace = useRef<HTMLDivElement>(null);
  const drag = useRef(false);
  useEffect(() => saveViewPreference(SPLIT_KEY, split), [split]);

  // Browser dev only: replay ?demo=... edits once the history exists (see mock.ts).
  const demoed = useRef(false);
  const ready = bridge.history !== null;
  useEffect(() => {
    const demo = q.get("demo");
    if (!ready || !demo || demoed.current || !document.documentElement.dataset.mock) return;
    demoed.current = true;
    import("./mock").then(async ({ demoScript }) => {
      const pause = () => new Promise((r) => setTimeout(r, 400));
      for (const s of demoScript(demo)) {
        if (s === "undo" || s === "redo") {
          if (s === "undo") bridge.undo();
          else bridge.redo();
          await pause();
        } else if ("preset" in s) {
          const p = bridge.presets.list.find((x) => x.name === s.preset);
          if (p) await bridge.presets.select(p.id, p.name);
        } else bridge.apply(s);
      }
    });
  }, [ready]);

  const select = (n: number) => {
    setSel(n);
    setInd(null);
    setExp(null);
    setTab("switches");
  };
  const selectIndicator = (i: IndicatorIndex) => {
    setInd(i);
    setExp(null);
    setTab("switches");
  };
  const selectExp = (n: 0 | 1) => {
    setExp(n);
    setInd(null);
    setTab("expression");
  };
  /** The Switches tab picked while a pedal is selected goes back to the last switch. */
  const pickTab = (t: Tab) => {
    if (t === "switches") setExp(null);
    setTab(t);
  };

  return (
    <div className="app-shell">
      <Header state={state}>
        <PresetPicker presets={bridge.presets} start={(q.get("picker") as PickerStart) || null} />
        <HistoryControls bridge={bridge} initialOpen={q.get("history") === "open"} />
      </Header>
      <main className="workspace">
        <div
          ref={workspace}
          className="monitor-column"
          style={{ "--viewer-split": `${split}%` } as CSSProperties}
        >
          <PedalViewer
            backend={backend}
            status={status}
            config={config}
            selected={ind === null && exp === null ? sel : -1}
            onSelect={select}
            selectedIndicator={ind}
            onSelectIndicator={selectIndicator}
            engaged={state?.expTrigger ?? []}
            simulated={state?.expSim ?? []}
            selectedExp={exp}
            onSelectExp={selectExp}
          />
          <div
            className="viewer-divider"
            role="separator"
            tabIndex={0}
            aria-label="Resize pedal viewer"
            aria-orientation="horizontal"
            aria-valuemin={40}
            aria-valuemax={82}
            aria-valuenow={Math.round(split)}
            title="Drag to resize · arrow keys to adjust · double-click to reset"
            onDoubleClick={() => setSplit(72)}
            onPointerDown={(e) => {
              drag.current = true;
              e.currentTarget.setPointerCapture(e.pointerId);
            }}
            onPointerMove={(e) => {
              if (!drag.current || !workspace.current) return;
              const rect = workspace.current.getBoundingClientRect();
              setSplit(Math.max(40, Math.min(82, ((e.clientY - rect.top) / rect.height) * 100)));
            }}
            onPointerUp={(e) => {
              drag.current = false;
              e.currentTarget.releasePointerCapture(e.pointerId);
            }}
            onLostPointerCapture={() => {
              drag.current = false;
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowUp" || e.key === "ArrowDown") {
                e.preventDefault();
                setSplit((value) =>
                  Math.max(40, Math.min(82, value + (e.key === "ArrowDown" ? 2 : -2))),
                );
              } else if (e.key === "Home") {
                e.preventDefault();
                setSplit(40);
              } else if (e.key === "End") {
                e.preventDefault();
                setSplit(82);
              }
            }}
          >
            <span />
          </div>
          <ActivityLog log={bridge.log} midi={state?.midi ?? null} />
        </div>

        <aside className="inspector" aria-label="Controller settings">
          <div className="inspector-heading">
            <span className="eyebrow">Configuration</span>
            <span className="inspector-meta">6 switches · 2 inputs</span>
          </div>
          <Tabs
            className="inspector-tabs"
            label="Controller sections"
            base={tabsId}
            tabs={TABS}
            value={tab}
            onChange={pickTab}
          />
          <div className="scroll-y min-h-0 flex-1">
            {!config || !state ? (
              <p className="p-4 text-ui-sm text-faint">Loading…</p>
            ) : (
              <TabPanel key={tab} base={tabsId} id={tab} from={tabFrom}>
                {tab === "switches" ? (
                  <div className="flex flex-col">
                    <SwitchTabs sw={ind === null ? sel : null} onSelect={select} />
                    {ind === null ? (
                      <SwitchEditor key={sel} config={config} sw={sel} apply={apply} />
                    ) : (
                      <IndicatorEditor key={ind} config={config} n={ind} apply={apply} />
                    )}
                  </div>
                ) : tab === "expression" ? (
                  <ExpressionPanel
                    config={config}
                    status={status}
                    engaged={state.expTrigger ?? []}
                    focus={exp}
                    apply={apply}
                    calibrate={bridge.calibrate}
                    sim={sim}
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
              </TabPanel>
            )}
          </div>
        </aside>
      </main>
    </div>
  );
}
