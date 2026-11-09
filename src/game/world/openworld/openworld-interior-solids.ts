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

/** A column seen along one axis: its extent along it, and the extent across it that two columns must share to merge. */
type Span = { from: number; to: number; side0: number; side1: number };

/** Spans that share both sides and abut along their axis, merged into one. */
function mergeSpans(spans: readonly Span[]): Span[] {
  const groups = new Map<string, Span[]>();
  for (const span of spans) {
    const key = `${span.side0.toFixed(KEY_PLACES)}:${span.side1.toFixed(KEY_PLACES)}`;
    groups.set(key, [...(groups.get(key) ?? []), span]);
  }
  const merged: Span[] = [];
  for (const group of groups.values()) {
    group.sort((a, b) => a.from - b.from);
    let current = { ...group[0]! };
    for (const next of group.slice(1)) {
      if (next.from - current.to <= TOUCH) current.to = Math.max(current.to, next.to);
      else {
        merged.push(current);
        current = { ...next };
      }
    }
    merged.push(current);
  }
  return merged;
}

/** Columns that share an extent and abut along the other axis, merged into one: a row of houses' street, back and party walls become a few long pieces. */
function mergeAlong(columns: readonly EnvelopeColumn[], alongX: boolean): EnvelopeColumn[] {
  const spans = columns.map((column): Span => (alongX ? { from: column.x0, to: column.x1, side0: column.z0, side1: column.z1 } : { from: column.z0, to: column.z1, side0: column.x0, side1: column.x1 }));
  return mergeSpans(spans).map((span): EnvelopeColumn => (alongX ? { x0: span.from, x1: span.to, z0: span.side0, z1: span.side1 } : { z0: span.from, z1: span.to, x0: span.side0, x1: span.side1 }));
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
