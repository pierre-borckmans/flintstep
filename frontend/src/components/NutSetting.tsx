import { RotateCcw, Shuffle } from "lucide-react";
import type { NutMode } from "../lib/nuts";
import { Button } from "../ui/Button";
import { Seg } from "../ui/Seg";
import { nuts, useNuts } from "../useNuts";

/** The hex nuts under the switch caps: square, shuffled, or turned to match the real
 *  pedal. Just looks; it's kept on this Mac, not in the mapping. */
export function NutSetting() {
  const { mode } = useNuts();
  return (
    <div className="flex flex-col gap-2">
      <span className="text-ui-sm text-muted">Nut rotation</span>
      <Seg<NutMode>
        label="Nut rotation"
        size="sm"
        options={[
          { value: "aligned", label: "Aligned" },
          { value: "shuffled", label: "Shuffled" },
          { value: "custom", label: "Match my pedal" },
        ]}
        value={mode}
        onChange={nuts.setMode}
      />
      <div className="flex min-h-6 items-center gap-3">
        <p className="flex-1 text-ui-xs leading-snug text-faint">
          {mode === "aligned"
            ? "Every nut square, as drawn."
            : mode === "shuffled"
              ? "Each nut where it stopped when it was tightened."
              : "Scroll over a nut or drag round it to turn it. Shift for fine steps, double-click for 0°."}
        </p>
        {mode === "shuffled" && (
          <Button size="sm" icon={<Shuffle size={12} />} onClick={nuts.shuffle}>
            Shuffle
          </Button>
        )}
        {mode === "custom" && (
          <Button size="sm" kind="ghost" icon={<RotateCcw size={12} />} onClick={nuts.resetAll}>
            Square all
          </Button>
        )}
      </div>
    </div>
  );
}
