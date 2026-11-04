import { useEffect, useState } from "react";
import { Button } from "../ui/Button";
import { Lamp } from "../ui/Lamp";
import type { Bridge } from "../useBridge";

/** Explicit save. The bar always says where the mapping stands: saved, unsaved, not
 *  valid, or rejected by the app, and ⌘S saves from anywhere. */
export function SaveBar({ bridge }: { bridge: Bridge }) {
  const { dirty, invalid, saving, saveError, savedAt, save, revert } = bridge;
  const [justSaved, setJustSaved] = useState(false);
  useEffect(() => {
    if (!savedAt) return;
    setJustSaved(true);
    const t = setTimeout(() => setJustSaved(false), 1600);
    return () => clearTimeout(t);
  }, [savedAt]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        save();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [save]);

  const problem = (dirty && invalid) || saveError;
  let lamp = <Lamp on={justSaved} colour="live" size={6} />;
  let text = <span className="text-faint">{justSaved ? "Saved" : "All changes saved"}</span>;
  if (problem) {
    lamp = <Lamp on colour="hot" size={6} />;
    text = <span className="text-hot">{problem}</span>;
  } else if (dirty) {
    lamp = <Lamp on colour="beam" size={6} />;
    text = <span className="text-text">Unsaved changes</span>;
  }

  return (
    <div className="flex min-h-12 shrink-0 items-center gap-2.5 border-t border-edge bg-panel px-4 py-2">
      {lamp}
      <span className="min-w-0 flex-1 text-ui-sm leading-tight" role="status">
        {text}
      </span>
      {dirty && (
        <Button kind="ghost" onClick={revert} disabled={saving}>
          Revert
        </Button>
      )}
      <Button
        kind={dirty && !invalid ? "primary" : "plain"}
        onClick={save}
        disabled={!dirty || !!invalid || saving}
        title="Save (⌘S)"
      >
        {saving ? "Saving…" : "Save"}
        <span className="text-ui-2xs font-normal text-muted">⌘S</span>
      </Button>
    </div>
  );
}
