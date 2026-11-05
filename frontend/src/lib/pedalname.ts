import type { PedalModel } from "../types";

// HOW THE UI NAMES A PEDAL. Go sends each pedal's model (sparkx/models.go): a known one
// by its name ("REACTOR Control"), "compatible" for an AirTurn-based pedal it only
// recognised by its services, none while unverified or with no pedal remembered.

/** sparkx.IDCompatible: a pedal with an unknown name that has the right services. */
export const COMPATIBLE = "compatible";

/** The pedal in a sentence, as Go's ble.Label says it: the model when it is a known one,
 *  else the advertised name, else "your pedal". */
export function pedalLabel(name: string, model?: PedalModel | null): string {
  if (model?.id && model.id !== COMPATIBLE) return model.name;
  if (name) return name;
  if (model?.id === COMPATIBLE) return `a ${model.name}`;
  return "your pedal";
}

/** The same, starting with a capital, for a label on its own ("Your pedal"). */
export function pedalTitle(name: string, model?: PedalModel | null): string {
  const s = pedalLabel(name, model).replace(/^a /, "");
  return s.charAt(0).toUpperCase() + s.slice(1);
}
