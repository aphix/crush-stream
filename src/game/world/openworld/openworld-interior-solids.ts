import type { z } from "zod";
import { PREFAB } from "../constants.ts";
import type { TrackSchema } from "../track-schema.ts";
import { interiorEnvelope, type EnvelopeColumn } from "./interior-plan.ts";
import type { Lots } from "./openworld-layout.ts";

type Prop = NonNullable<z.input<typeof TrackSchema>["props"]>[number];

/** An envelope wall piece's height (m): taller than any building, so no car and no walker clears it. */
const ENVELOPE_HEIGHT = 12;
const QUARTER_TURN = Math.PI / 2;
/** Two columns whose edges are this close (m) touch. */
const TOUCH = 1e-6;
/** Decimal places a column's shared extent is keyed at when grouping the columns that can merge. */
const KEY_PLACES = 3;

/** Columns that share an extent and abut along the other axis, merged into one: a row of houses' street, back and party walls become a few long pieces. */
function mergeAlong(columns: readonly EnvelopeColumn[], alongX: boolean): EnvelopeColumn[] {
  const lo = alongX ? "x0" : "z0";
  const hi = alongX ? "x1" : "z1";
  const groups = new Map<string, EnvelopeColumn[]>();
  for (const column of columns) {
    const key = alongX ? `${column.z0.toFixed(KEY_PLACES)}:${column.z1.toFixed(KEY_PLACES)}` : `${column.x0.toFixed(KEY_PLACES)}:${column.x1.toFixed(KEY_PLACES)}`;
    groups.set(key, [...(groups.get(key) ?? []), column]);
  }
  const merged: EnvelopeColumn[] = [];
  for (const group of groups.values()) {
    group.sort((a, b) => a[lo] - b[lo]);
    let current = { ...group[0]! };
    for (const next of group.slice(1)) {
      if (next[lo] - current[hi] <= TOUCH) current[hi] = Math.max(current[hi], next[hi]);
      else {
        merged.push(current);
        current = { ...next };
      }
    }
    merged.push(current);
  }
  return merged;
}

/**
 * The walls of every enterable building as invisible-wall props: the ground floor's street, party and back walls, whole but for the doorways, merged along each row of houses. The drawn building is a `buildingShell`,
 * which has no collider. What is inside (slabs, stairs, furniture) is handed to the physics as fixed boxes while an eye is near (`InteriorSet.onSolids`).
 */
export function interiorEnvelopeProps(lots: Lots): Prop[] {
  const columns = lots.places.slice(0, lots.backdropStart).flatMap((place) => (place.interior === undefined ? [] : interiorEnvelope(place)));
  return mergeAlong(mergeAlong(columns, true), false).map((column): Prop => {
    const alongX = column.x1 - column.x0 > column.z1 - column.z0;
    const thickness = alongX ? column.z1 - column.z0 : column.x1 - column.x0;
    const length = alongX ? column.x1 - column.x0 : column.z1 - column.z0;
    return { prefab: PREFAB.invisibleWall, x: (column.x0 + column.x1) / 2, z: (column.z0 + column.z1) / 2, yaw: alongX ? QUARTER_TURN : 0, size: [thickness, ENVELOPE_HEIGHT, length] };
  });
}
