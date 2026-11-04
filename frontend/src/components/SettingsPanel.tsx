import { FolderOpen, Radar, RotateCcw } from "lucide-react";
import { useState } from "react";
import type { Backend } from "../api";
import { errorText } from "../api";
import { LONG_PRESS, type Op } from "../lib/config";
import type { Config, Device, State } from "../types";
import { Button } from "../ui/Button";
import { cx } from "../ui/cx";
import { Lamp } from "../ui/Lamp";
import { Seg } from "../ui/Seg";
import { Toggle } from "../ui/Toggle";
import { Section } from "./Section";

function Slider({
  value,
  min,
  max,
  step,
  onChange,
  label,
  unit,
}: {
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  label: string;
  unit: string;
}) {
  const fill = ((value - min) / (max - min)) * 100;
  return (
    <div className="flex items-center gap-3">
      <span className="w-24 shrink-0 text-ui-sm text-muted">{label}</span>
      <input
        type="range"
        aria-label={label}
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="min-w-0 flex-1"
        style={{ "--fill": `${fill}%` } as React.CSSProperties}
      />
      <span className="w-14 text-right font-mono text-ui-sm text-bone tabular-nums">
        {value}
        <span className="text-muted"> {unit}</span>
      </span>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex min-h-7 items-center gap-3">
      <span className="flex-1 text-ui-sm text-muted">{label}</span>
      {children}
    </div>
  );
}

/** Signal bars from RSSI: -50 and better is full. */
function Bars({ rssi }: { rssi: number }) {
  const n = rssi >= -55 ? 4 : rssi >= -67 ? 3 : rssi >= -80 ? 2 : 1;
  return (
    <span className="flex items-end gap-[2px]" title={`${rssi} dBm`}>
      {[1, 2, 3, 4].map((i) => (
        <span
          key={i}
          className={cx("w-[3px] rounded-[1px]", i <= n ? "bg-muted" : "bg-edge-strong")}
          style={{ height: 3 + i * 2 }}
        />
      ))}
    </span>
  );
}

function PedalPicker({ backend, state }: { backend: Backend; state: State }) {
  const [scanning, setScanning] = useState(false);
  const [found, setFound] = useState<Device[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const remembered = state.config.pedal;
  const connected = state.pedal.state === "connected" ? state.pedal.address : "";

  const scan = async () => {
    setScanning(true);
    setErr(null);
    try {
      setFound(await backend.Scan());
    } catch (e) {
      setErr(errorText(e));
    } finally {
      setScanning(false);
    }
  };
  const run = (p: Promise<void>) => p.catch((e) => setErr(errorText(e)));

  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex items-center gap-2.5">
        <Lamp on={!!connected} colour="live" size={6} />
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-ui-md text-text">
            {remembered.name || "Any Spark Control X"}
          </span>
          <span className="truncate font-mono text-ui-2xs text-faint">
            {remembered.address || "connects to the first pedal it finds"}
          </span>
        </div>
        <Button size="sm" onClick={scan} disabled={scanning} icon={<Radar size={12} />}>
          {scanning ? "Scanning…" : "Scan"}
        </Button>
        {remembered.address && (
          <Button size="sm" kind="ghost" onClick={() => run(backend.ForgetPedal())}>
            Forget
          </Button>
        )}
      </div>
      {scanning && (
        <div className="flex items-center gap-2 text-ui-xs text-muted">
          <Lamp on colour="beam" size={5} className="breathe" />
          Looking for pedals nearby. Wake yours by pressing a switch.
        </div>
      )}
      {found && !scanning && (
        <ul className="flex flex-col overflow-hidden rounded-ui-md border border-edge">
          {found.length === 0 && (
            <li className="px-3 py-2 text-ui-xs text-faint">
              No pedal found. Is it on, and not connected to the Spark app on a phone?
            </li>
          )}
          {found.map((d) => {
            const current = d.address === remembered.address;
            return (
              <li
                key={d.address}
                className="flex items-center gap-2.5 border-t border-edge bg-sunken/50 px-3 py-1.5 first:border-t-0"
              >
                <Bars rssi={d.rssi} />
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-ui-sm text-text">{d.name}</span>
                  <span className="truncate font-mono text-ui-2xs text-faint">
                    {d.address}
                    {d.system && " · paired with this Mac"}
                  </span>
                </div>
                {current ? (
                  <span className="text-ui-xs text-muted">Chosen</span>
                ) : (
                  <Button
                    size="sm"
                    onClick={() =>
                      run(backend.ChoosePedal(d.address, d.name).then(() => setFound(null)))
                    }
                  >
                    Use
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {err && <p className="text-ui-xs text-hot">{err}</p>}
    </div>
  );
}

export function SettingsPanel({
  backend,
  state,
  config,
  apply,
  reset,
}: {
  backend: Backend;
  state: State;
  config: Config;
  apply: (op: Op) => void;
  reset: () => Promise<void>;
}) {
  const [login, setLogin] = useState(state.launchAtLogin);
  const [confirm, setConfirm] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  return (
    <div className="flex flex-col">
      <Section title="LEDs">
        <Seg
          label="LED mode"
          options={[
            { value: "local", label: "Local" },
            { value: "feedback", label: "MIDI feedback" },
          ]}
          value={config.ledMode}
          onChange={(mode) => apply({ type: "ledMode", mode })}
        />
        <p className="text-ui-xs leading-snug text-faint">
          {config.ledMode === "local" ? (
            "A switch lights while you hold it, and stays lit while its toggle is on."
          ) : (
            <>
              Your DAW drives the lights: send the same CC or note back to{" "}
              <span className="text-muted">“{state.midi.dest || "Spark Control X LEDs"}”</span> and
              the switch lights while the value is above 0.
            </>
          )}
        </p>
        <Slider
          label="Brightness"
          value={config.brightness}
          min={0}
          max={100}
          step={5}
          unit="%"
          onChange={(value) => apply({ type: "brightness", value })}
        />
        <p className="text-ui-xs leading-snug text-faint">
          Click AMP or APP on the pedal to choose what those two lamps show.
        </p>
      </Section>

      <Section title="Switches">
        <Slider
          label="Long press after"
          value={config.longPressMs}
          min={LONG_PRESS.min}
          max={LONG_PRESS.max}
          step={LONG_PRESS.step}
          unit="ms"
          onChange={(value) => apply({ type: "longPressMs", value })}
        />
      </Section>

      <Section title="Pedal">
        <PedalPicker backend={backend} state={state} />
      </Section>

      <Section title="App">
        <Row label="Launch at login">
          <Toggle
            label="Launch at login"
            on={login}
            onChange={(on) => {
              setLogin(on);
              backend.SetLaunchAtLogin(on).catch((e) => {
                setLogin(!on);
                setErr(errorText(e));
              });
            }}
          />
        </Row>
        <Row label="Logs and Bluetooth trace">
          <Button
            size="sm"
            icon={<FolderOpen size={12} />}
            onClick={() => backend.RevealLogs().catch((e) => setErr(errorText(e)))}
          >
            Reveal in Finder
          </Button>
        </Row>
        <Row label="Mapping">
          {confirm ? (
            <span className="flex items-center gap-1.5">
              <Button size="sm" kind="ghost" onClick={() => setConfirm(false)}>
                Cancel
              </Button>
              <Button
                size="sm"
                kind="destroy"
                onClick={() =>
                  reset()
                    .then(() => setConfirm(false))
                    .catch((e) => setErr(errorText(e)))
                }
              >
                Reset everything
              </Button>
            </span>
          ) : (
            <Button
              size="sm"
              kind="danger"
              icon={<RotateCcw size={12} />}
              onClick={() => setConfirm(true)}
            >
              Reset to defaults
            </Button>
          )}
        </Row>
        {confirm && (
          <p className="text-ui-xs leading-snug text-muted">
            Every switch goes back to CC 80 to 85, combos are removed and both expression inputs
            lose their calibration. The chosen pedal is kept, and ⌘Z brings the rest back.
          </p>
        )}
        {err && <p className="text-ui-xs text-hot">{err}</p>}
        <p className="pt-1 text-ui-2xs text-faint">SparkX MIDI {state.version}</p>
      </Section>
    </div>
  );
}
