// A stand-in for the app-wide tooltip engine (ported from Beam's src/ui/tooltip.ts on
// another branch), with its signature, so the pedal canvas can call it now. The real one
// replaces this file on merge.

export interface TooltipRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Show `text` by `rect` (viewport px). The engine handles the hover delay. */
export function showTooltipAt(_rect: TooltipRect, _text: string, _opts?: object): void {}

export function hideTooltip(): void {}
