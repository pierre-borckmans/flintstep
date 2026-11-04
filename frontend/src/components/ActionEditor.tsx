import { noteName, parseNote } from "../lib/notes";
import type { Action, ActionKind } from "../types";
import { NumField } from "../ui/NumField";
import { Seg } from "../ui/Seg";

const KINDS: { value: ActionKind; label: string }[] = [
  { value: "off", label: "Off" },
  { value: "cc", label: "CC" },
  { value: "note", label: "Note" },
  { value: "pc", label: "Program" },
];

/** One action: kind, then the fields that kind uses. `allowOff` is false where "off"
 *  is expressed elsewhere (the long-press toggle). `describe` replaces the line that
 *  says what it sends, for things that are not pressed (an expression trigger). */
export function ActionEditor({
  action,
  onChange,
  allowOff = true,
  describe = explain,
}: {
  action: Action;
  onChange: (patch: Partial<Action>) => void;
  allowOff?: boolean;
  describe?: (a: Action) => string;
}) {
  const a = action;
  return (
    <div className="flex flex-col gap-2">
      <Seg
        label="Message type"
        options={allowOff ? KINDS : KINDS.slice(1)}
        value={a.kind}
        onChange={(kind) => onChange({ kind })}
      />
      {a.kind !== "off" && (
        <div className={a.kind === "pc" ? "grid grid-cols-2 gap-2" : "grid grid-cols-3 gap-2"}>
          <NumField
            label="Ch"
            value={a.channel}
            min={1}
            max={16}
            onChange={(channel) => onChange({ channel })}
          />
          {a.kind === "note" ? (
            <NumField
              key="note"
              label="Note"
              value={a.number}
              min={0}
              max={127}
              parse={parseNote}
              format={(v) => `${noteName(v)}`}
              suffix={String(a.number)}
              onChange={(number) => onChange({ number })}
            />
          ) : (
            <NumField
              key={a.kind}
              label={a.kind === "cc" ? "CC" : "Prog"}
              value={a.number}
              min={0}
              max={127}
              onChange={(number) => onChange({ number })}
            />
          )}
          {a.kind !== "pc" && (
            <NumField
              label={a.kind === "note" ? "Vel" : "Value"}
              value={a.value}
              min={1}
              max={127}
              onChange={(value) => onChange({ value })}
            />
          )}
        </div>
      )}
      {a.kind === "cc" && (
        <Seg
          size="sm"
          label="CC mode"
          options={[
            { value: "momentary", label: "Momentary" },
            { value: "toggle", label: "Toggle" },
          ]}
          value={a.mode}
          onChange={(mode) => onChange({ mode })}
        />
      )}
      <p className="text-ui-xs leading-snug text-faint">
        {a.kind === "off"
          ? "Sends nothing. Pick CC, Note or Program to choose what this sends."
          : describe(a)}
      </p>
    </div>
  );
}

function explain(a: Action): string {
  switch (a.kind) {
    case "cc":
      return a.mode === "toggle"
        ? `Each press alternates ${a.value} and 0.`
        : `Sends ${a.value} on press, 0 on release.`;
    case "note":
      return `Note on (${noteName(a.number)}, velocity ${a.value}) on press, note off on release.`;
    case "pc":
      return `Program change ${a.number} on press. Programs count from 0.`;
    default:
      return "";
  }
}
