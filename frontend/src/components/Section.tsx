import type { ReactNode } from "react";
import { Kicker } from "../ui/Kicker";

/** A titled group in the editor panel. Hairline above, no box. */
export function Section({
  title,
  aside,
  children,
}: {
  title: string;
  aside?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="editor-section flex flex-col gap-3 border-t border-edge px-5 pt-4 pb-5 first:border-t-0">
      <div className="flex min-h-5 items-center gap-2">
        <Kicker>{title}</Kicker>
        <div className="flex-1" />
        {aside}
      </div>
      {children}
    </section>
  );
}
