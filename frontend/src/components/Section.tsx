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
    <section className="flex flex-col gap-2.5 border-t border-edge px-4 pt-3 pb-4 first:border-t-0">
      <div className="flex min-h-5 items-center gap-2">
        <Kicker>{title}</Kicker>
        <div className="flex-1" />
        {aside}
      </div>
      {children}
    </section>
  );
}
