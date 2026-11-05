import { type RefObject, useEffect, useState } from "react";
import type { Size } from "./camera";

const ZERO: Size = { w: 0, h: 0 };

/**
 * The element's size, as state.
 *
 * The camera must NEVER live in React state — that is the whole point of the canvas — but
 * the room's size must, because the scene's LAYOUT depends on it: how wide the chain packs
 * and therefore how many rows it takes. That changes on a window resize and nothing else,
 * so it is a handful of renders an hour rather than sixty a second.
 *
 * Knowing which of the two is which is most of the design. Anything that changes with a
 * gesture is mutated inside the canvas; anything that changes the SHAPE of the scene comes
 * through here and re-renders honestly.
 */
export function useHostSize(ref: RefObject<HTMLElement | null>): Size {
  const [size, setSize] = useState<Size>(ZERO);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const read = () =>
      setSize((was) =>
        was.w === el.clientWidth && was.h === el.clientHeight
          ? was
          : { w: el.clientWidth, h: el.clientHeight },
      );
    read();
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return size;
}
