import type { PlacementPref } from "../lib/exppedal";
import { Seg } from "../ui/Seg";
import { setExpPlacement, useExpPlacement } from "../useExpPlacement";

/** Where plugged-in expression pedals are drawn. Kept on this Mac, not in the mapping. */
export function ExpPlacementSetting() {
  const mode = useExpPlacement();
  return (
    <div className="flex flex-col gap-2">
      <span className="text-ui-sm text-muted">Expression pedals</span>
      <Seg<PlacementPref>
        label="Expression pedals"
        size="sm"
        options={[
          {
            value: "auto",
            label: "Auto",
            title: "Behind or beside the Spark, whichever draws it bigger",
          },
          { value: "behind", label: "Behind", title: "Behind the Spark, cables straight back" },
          { value: "beside", label: "Beside", title: "To the right of the Spark" },
        ]}
        value={mode}
        onChange={setExpPlacement}
      />
      <p className="text-ui-xs leading-snug text-faint">
        {mode === "auto"
          ? "Behind the Spark or beside it, whichever leaves it bigger in the window."
          : mode === "behind"
            ? "Behind the Spark, cables straight back from the jacks."
            : "To the right of the Spark, cables round its corner."}
      </p>
    </div>
  );
}
