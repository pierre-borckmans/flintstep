import { ChevronDown, Copy, Download, FilePlus, Pencil, Plus, Trash2, Upload } from "lucide-react";
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { errorText } from "../api";
import { checkName, listKey, MAX_NAME } from "../lib/presets";
import type { PresetInfo } from "../types";
import { Button } from "../ui/Button";
import { cx } from "../ui/cx";
import { Kicker } from "../ui/Kicker";
import { Lamp } from "../ui/Lamp";
import type { Presets } from "../useBridge";

/** What a row is doing besides being listed. */
type RowMode = { kind: "rename"; id: string } | { kind: "delete"; id: string } | null;

export type PickerStart = "open" | "rename" | "delete" | null;

function IconButton({
  label,
  onClick,
  disabled,
  danger,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      tabIndex={-1}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className={cx(
        "grid size-6 place-items-center rounded-ui-sm text-muted transition-[color,background-image] duration-(--dur) ease-(--ease) disabled:cursor-default disabled:opacity-30",
        danger ? "enabled:hover:text-hot" : "enabled:hover:text-text enabled:hover:warm",
      )}
    >
      {children}
    </button>
  );
}

function RenameRow({
  preset,
  presets,
  onDone,
  onSave,
}: {
  preset: PresetInfo;
  presets: PresetInfo[];
  onDone: () => void;
  onSave: (name: string) => Promise<void>;
}) {
  const [value, setValue] = useState(preset.name);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);

  const save = async () => {
    const r = checkName(value, presets, preset.id);
    if ("error" in r) return setError(r.error);
    if (r.name === preset.name) return onDone();
    try {
      await onSave(r.name);
      onDone();
    } catch (e) {
      setError(errorText(e));
    }
  };

  return (
    <div className="px-2 py-1">
      <input
        ref={ref}
        value={value}
        maxLength={MAX_NAME + 10}
        aria-label="Preset name"
        aria-invalid={!!error}
        onChange={(e) => {
          setValue(e.target.value);
          setError(null);
        }}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Enter") void save();
          if (e.key === "Escape") onDone();
        }}
        onBlur={() => void save()}
        style={{ outline: "none" }}
        className={cx(
          "h-7 w-full rounded-ui-sm border bg-sunken px-2 text-ui-sm text-bone outline-none",
          error ? "border-hot/70" : "border-edge-strong focus:border-cold/60",
        )}
      />
      {error && <p className="px-0.5 pt-1 text-ui-xs text-hot">{error}</p>}
    </div>
  );
}

function DeleteRow({
  preset,
  onCancel,
  onDelete,
}: {
  preset: PresetInfo;
  onCancel: () => void;
  onDelete: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  // The safe default for Enter would be Cancel; Delete is focused because the user
  // already asked for it once, and Esc is right there.
  useEffect(() => ref.current?.querySelector<HTMLButtonElement>("[data-confirm]")?.focus(), []);
  return (
    <div
      ref={ref}
      className="flex items-center gap-2 bg-panel2 px-3 py-1.5"
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          onCancel();
        }
      }}
    >
      <span className="min-w-0 flex-1 truncate text-ui-sm text-text">
        Delete <span className="text-bone">{preset.name}</span>?
      </span>
      <Button size="sm" kind="ghost" onClick={onCancel}>
        Cancel
      </Button>
      <Button data-confirm size="sm" kind="destroy" onClick={onDelete}>
        Delete
      </Button>
    </div>
  );
}

/** The preset list: the active one lit, a click switches, the row's own buttons rename,
 *  duplicate, export or delete it. ↑/↓ move, Enter switches, F2 renames, Esc closes. */
function PresetMenu({
  presets: p,
  onClose,
  start,
}: {
  presets: Presets;
  onClose: () => void;
  start: PickerStart;
}) {
  const list = p.list;
  const activeIndex = Math.max(
    0,
    list.findIndex((x) => x.id === p.active),
  );
  const [hi, setHi] = useState(activeIndex);
  // A switch made elsewhere (the menu bar, an undo) moves the highlight with it.
  useEffect(() => setHi(activeIndex), [activeIndex]);
  const [mode, setMode] = useState<RowMode>(() => {
    const target = list.find((x) => x.id !== p.active) ?? list[0];
    if (start === "rename" && list[activeIndex])
      return { kind: "rename", id: list[activeIndex].id };
    if (start === "delete" && target) return { kind: "delete", id: target.id };
    return null;
  });
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLOListElement>(null);

  useEffect(() => {
    if (!mode) listRef.current?.focus();
  }, [mode]);

  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (ref.current?.contains(t) || (t as Element).closest?.("[data-preset-toggle]")) return;
      onClose();
    };
    window.addEventListener("pointerdown", onDown);
    return () => window.removeEventListener("pointerdown", onDown);
  }, [onClose]);

  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${hi}"]`)?.scrollIntoView({ block: "nearest" });
  }, [hi]);

  /** Runs a library call, showing its error here. */
  const act = async <R,>(fn: () => Promise<R>): Promise<R | undefined> => {
    setError(null);
    try {
      return await fn();
    } catch (e) {
      setError(errorText(e));
      return undefined;
    }
  };

  const choose = (x: PresetInfo) => {
    if (x.id !== p.active) void p.select(x.id, x.name);
    onClose();
  };

  const startRename = (id: string) => setMode({ kind: "rename", id });

  const create = async (from: "current" | "default") => {
    const info = await act(() => p.create(from));
    if (info) startRename(info.id);
  };
  const duplicate = async (x: PresetInfo) => {
    const info = await act(() => p.duplicate(x.id));
    if (info) startRename(info.id);
  };
  const importOne = async () => {
    const info = await act(() => p.import());
    if (info) onClose();
  };

  const onKey = (e: React.KeyboardEvent) => {
    const a = listKey(e.key, hi, list.length);
    if (!a) return;
    e.preventDefault();
    if (a.type === "close") onClose();
    else if (a.type === "move") setHi(a.index);
    else if (a.type === "choose") choose(list[a.index]);
    else if (a.type === "rename") startRename(list[a.index].id);
  };

  const shownError = error ?? p.error;

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label="Presets"
      className="fade-up absolute top-[calc(100%+4px)] right-2 left-2 z-20 flex max-h-[420px] flex-col overflow-hidden rounded-ui-lg border border-edge-strong bg-panel shadow-pop"
    >
      <div className="flex h-8 shrink-0 items-center gap-2 border-b border-edge px-3">
        <Kicker>Presets</Kicker>
        <div className="flex-1" />
        <span className="text-ui-2xs text-faint">
          {list.length} {list.length === 1 ? "preset" : "presets"}
        </span>
      </div>
      {p.libraryError && (
        <p className="border-b border-edge px-3 py-2 text-ui-xs leading-snug text-hot first-letter:uppercase">
          {p.libraryError}
        </p>
      )}
      <ol
        ref={listRef}
        role="listbox"
        aria-label="Presets"
        aria-activedescendant={list[hi] ? `preset-${list[hi].id}` : undefined}
        tabIndex={0}
        onKeyDown={onKey}
        className="group/list scroll-y min-h-0 flex-1 py-1"
        // The highlighted row shows where focus is; the global outline would box the list.
        style={{ outline: "none" }}
      >
        {list.map((x, i) => {
          const isActive = x.id === p.active;
          if (mode?.kind === "rename" && mode.id === x.id) {
            return (
              <li key={x.id}>
                <RenameRow
                  preset={x}
                  presets={list}
                  onDone={() => setMode(null)}
                  onSave={(name) => p.rename(x.id, name)}
                />
              </li>
            );
          }
          if (mode?.kind === "delete" && mode.id === x.id) {
            return (
              <li key={x.id}>
                <DeleteRow
                  preset={x}
                  onCancel={() => setMode(null)}
                  onDelete={async () => {
                    setMode(null);
                    await act(() => p.remove(x.id));
                    setHi((h) => Math.min(h, list.length - 2));
                  }}
                />
              </li>
            );
          }
          return (
            <li
              key={x.id}
              id={`preset-${x.id}`}
              role="option"
              aria-selected={isActive}
              data-index={i}
              onPointerMove={() => setHi(i)}
              onClick={() => choose(x)}
              className={cx(
                "group grid h-8 cursor-pointer grid-cols-[6px_1fr_auto] items-center gap-2.5 pr-1.5 pl-3 transition-[background-color] duration-(--dur-fast) ease-(--ease)",
                i === hi &&
                  "bg-panel2 group-focus-visible/list:shadow-[inset_2px_0_0_var(--color-cold)]",
              )}
            >
              <Lamp on={isActive} colour="cold" size={6} />
              <span
                className={cx(
                  "truncate text-ui-sm",
                  isActive ? "font-semibold text-bone" : "text-text/90",
                )}
                title={x.name}
              >
                {x.name}
              </span>
              <span
                className={cx(
                  "flex items-center opacity-0 transition-opacity duration-(--dur-fast) group-hover:opacity-100",
                  i === hi && "opacity-100",
                )}
              >
                <IconButton label="Rename" onClick={() => startRename(x.id)}>
                  <Pencil size={12} />
                </IconButton>
                <IconButton label="Duplicate" onClick={() => void duplicate(x)}>
                  <Copy size={12} />
                </IconButton>
                <IconButton label="Export…" onClick={() => void act(() => p.export(x.id))}>
                  <Download size={12} />
                </IconButton>
                <IconButton
                  label={list.length === 1 ? "The last preset cannot be deleted" : "Delete…"}
                  disabled={list.length === 1}
                  danger
                  onClick={() => setMode({ kind: "delete", id: x.id })}
                >
                  <Trash2 size={12} />
                </IconButton>
              </span>
            </li>
          );
        })}
      </ol>
      {shownError && (
        <p role="alert" className="border-t border-edge px-3 py-2 text-ui-xs text-hot">
          {shownError}
        </p>
      )}
      <div className="flex shrink-0 items-center gap-0.5 border-t border-edge px-1.5 py-1.5">
        <Button
          size="sm"
          kind="ghost"
          icon={<Plus size={12} />}
          title="A new preset, starting as a copy of this one"
          onClick={() => void create("current")}
        >
          New from current
        </Button>
        <Button
          size="sm"
          kind="ghost"
          icon={<FilePlus size={12} />}
          title="A new preset with the default mapping"
          onClick={() => void create("default")}
        >
          New blank
        </Button>
        <div className="flex-1" />
        <Button
          size="sm"
          kind="ghost"
          icon={<Upload size={12} />}
          title="Add a preset from a .sparkx.json file (an old config.json works too)"
          onClick={() => void importOne()}
        >
          Import…
        </Button>
      </div>
    </div>
  );
}

/** The editor's preset: its name, and a menu to switch, add, rename, delete, import
 *  and export them. */
export function PresetPicker({ presets, start = null }: { presets: Presets; start?: PickerStart }) {
  const [open, setOpen] = useState(start !== null);
  // ?picker= opens it once in a given state (screenshots); reopening starts plain.
  const [initial, setInitial] = useState(start);
  const close = useCallback(() => {
    setOpen(false);
    setInitial(null);
  }, []);
  const current = presets.list.find((x) => x.id === presets.active);
  return (
    <div className="relative shrink-0 border-b border-edge">
      <button
        type="button"
        data-preset-toggle
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => (open ? close() : setOpen(true))}
        className={cx(
          "flex h-10 w-full items-center gap-2.5 px-3 text-left transition-[background-image] duration-(--dur) ease-(--ease)",
          open ? "warm" : "hover:warm",
        )}
      >
        <Kicker className="shrink-0">Preset</Kicker>
        <span className="min-w-0 flex-1 truncate text-ui-base font-semibold text-bone">
          {current?.name ?? "…"}
        </span>
        {(presets.libraryError || presets.error) && <Lamp on colour="hot" size={6} />}
        <ChevronDown
          size={14}
          className={cx(
            "shrink-0 text-muted transition-transform duration-(--dur) ease-(--ease)",
            open && "rotate-180",
          )}
        />
      </button>
      {open && presets.list.length > 0 && (
        <PresetMenu presets={presets} onClose={close} start={initial} />
      )}
    </div>
  );
}
