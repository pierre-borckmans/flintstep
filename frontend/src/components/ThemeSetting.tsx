import { systemLookName } from "../lib/platform";
import type { ThemeMode } from "../lib/theme";
import { Seg } from "../ui/Seg";
import { setTheme, useTheme } from "../useTheme";

/** System, Dark or Light. Kept on this Mac, not in the mapping. */
export function ThemeSetting() {
  const { mode, resolved } = useTheme();
  return (
    <div className="flex flex-col gap-2">
      <span className="text-ui-sm text-muted">Theme</span>
      <Seg<ThemeMode>
        label="Theme"
        size="sm"
        options={[
          { value: "system", label: "System" },
          { value: "dark", label: "Dark" },
          { value: "light", label: "Light" },
        ]}
        value={mode}
        onChange={setTheme}
      />
      <p className="text-ui-xs leading-snug text-faint">
        {mode === "system"
          ? `Follows ${systemLookName()}, which is ${resolved} right now.`
          : "The pedal stays black: it's drawn as the hardware is."}
      </p>
    </div>
  );
}
