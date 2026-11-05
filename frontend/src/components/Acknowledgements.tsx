import { X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { Backend } from "../api";
import { errorText, openURL } from "../api";
import { type Notices, parseNotices } from "../lib/notices";
import { Button } from "../ui/Button";
import { Kicker } from "../ui/Kicker";

/** The third-party notices in a modal sheet: each licence, the components under it, and
 *  its text folded away. Esc, the close button or a click outside closes it. */
export function Acknowledgements({ backend, onClose }: { backend: Backend; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [notices, setNotices] = useState<Notices | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
    backend
      .ThirdPartyNotices()
      .then((md) => setNotices(parseNotices(md)))
      .catch((e) => setErr(errorText(e)));
  }, [backend]);

  return (
    <dialog
      ref={ref}
      aria-label="Acknowledgements"
      onClose={onClose}
      onPointerDown={(e) => e.target === ref.current && ref.current?.close()}
      className="popover m-auto max-h-[min(640px,calc(100vh-48px))] w-[560px] max-w-[calc(100vw-24px)] flex-col overflow-hidden rounded-ui-lg border border-edge-strong bg-panel p-0 open:flex text-text shadow-pop backdrop:bg-black/40"
      data-state="open"
    >
      <div className="flex items-center gap-2 border-b border-edge px-5 py-3">
        <Kicker>Acknowledgements</Kicker>
        <div className="flex-1" />
        <Button
          size="sm"
          kind="ghost"
          aria-label="Close"
          icon={<X size={13} />}
          onClick={() => ref.current?.close()}
        />
      </div>
      <div className="scroll-y flex min-h-0 flex-1 flex-col gap-4 px-5 py-4">
        {err && <p className="text-ui-xs text-hot">{err}</p>}
        {!notices && !err && <p className="text-ui-sm text-faint">Loading…</p>}
        {notices?.intro.map((p) => (
          <p key={p} className="text-ui-xs leading-snug text-muted">
            {p}
          </p>
        ))}
        {notices?.licences.map((l) => (
          <section key={l.id} className="flex flex-col gap-2 border-t border-edge pt-3">
            <span className="text-ui-sm font-semibold text-bone">{l.id}</span>
            {l.texts.map((t) => (
              <div key={t.components[0]?.name ?? t.text} className="flex flex-col gap-1.5">
                <ul className="flex flex-col gap-0.5">
                  {t.components.map((c) => (
                    <li key={c.name} className="flex items-baseline gap-2 text-ui-xs">
                      <a
                        href={c.url}
                        onClick={(e) => {
                          e.preventDefault();
                          openURL(c.url);
                        }}
                        className="truncate text-text hover:text-beam"
                      >
                        {c.name}
                      </a>
                      <span className="shrink-0 font-mono text-ui-2xs text-faint">{c.detail}</span>
                    </li>
                  ))}
                </ul>
                <details className="group">
                  <summary className="cursor-default text-ui-2xs text-faint select-none hover:text-muted">
                    Licence text
                  </summary>
                  <pre className="mt-1.5 rounded-ui-sm bg-sunken p-3 font-mono text-ui-2xs leading-relaxed whitespace-pre-wrap text-muted">
                    {t.text}
                  </pre>
                </details>
              </div>
            ))}
          </section>
        ))}
      </div>
    </dialog>
  );
}
