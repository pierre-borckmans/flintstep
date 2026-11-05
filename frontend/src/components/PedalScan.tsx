import { useState } from "react";
import type { Backend } from "../api";
import { errorText } from "../api";
import type { Device } from "../types";
import { Button } from "../ui/Button";
import { Collapse } from "../ui/Collapse";
import { cx } from "../ui/cx";
import { Lamp } from "../ui/Lamp";

// The scan-and-choose flow, shared by Settings > Pedal and the pedal viewer's overlay:
// Scan lists the pedals nearby, Choose (or Use) makes one the pedal to connect to.

export function usePedalScan(backend: Backend) {
  const [scanning, setScanning] = useState(false);
  const [found, setFound] = useState<Device[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

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
  const choose = (d: Device) =>
    run(backend.ChoosePedal(d.address, d.name).then(() => setFound(null)));
  const forget = () => run(backend.ForgetPedal());
  return { scanning, found, err, scan, choose, forget, run };
}

export type PedalScan = ReturnType<typeof usePedalScan>;

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

/** "Looking for pedals nearby" while a scan runs, then what it found, each with a button
 *  to choose it; the remembered one says Chosen instead. */
export function ScanResults({
  scan,
  remembered,
  choose = "Use",
  className,
}: {
  scan: PedalScan;
  remembered: string;
  choose?: string;
  className?: string;
}) {
  const { scanning, found, err } = scan;
  return (
    <>
      <Collapse open={scanning}>
        <div className="flex items-center gap-2 text-ui-xs text-muted">
          <Lamp on colour="beam" size={5} className="breathe" />
          Looking for pedals nearby. Wake yours by pressing a switch.
        </div>
      </Collapse>
      {found && !scanning && (
        <ul
          className={cx(
            "flex flex-col overflow-hidden rounded-ui-md border border-edge",
            className,
          )}
        >
          {found.length === 0 && (
            <li className="px-3 py-2 text-ui-xs text-faint">
              No pedal found. Is it on, and not connected to the Spark app on a phone?
            </li>
          )}
          {found.map((d) => (
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
              {d.address === remembered ? (
                <span className="text-ui-xs text-muted">Chosen</span>
              ) : (
                <Button size="sm" onClick={() => scan.choose(d)}>
                  {choose}
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      {err && <p className="text-ui-xs text-hot">{err}</p>}
    </>
  );
}
