import assert from "node:assert/strict";
import type { TestContext } from "node:test";
import { DEG, MATRIX_HEAD, matrixRow, type Cell } from "./ground-probe.test-util.ts";
import type { VehicleClassId } from "./vehicle-classes.ts";

/**
 * The ground-fit drop matrix's judge, shared by every course's matrix (ground-fit.test.ts: ramps, stunt, rally; havana-fit.test.ts):
 * a car dropped 0.5 m onto each site at every heading, brake and handbrake held, must sit ON the ground, whatever the ground is: no
 * tyre sunk in it, some tyre or the hull resting on it (not hanging over it), no underside in it or in a wall, and on a smooth slope or
 * bank the body as tilted as the ground under its hubs. Everything is read through `Ground.heightAt` (ground-probe.test-util.ts
 * `fit`). A new site is one line in a table; each group prints its whole matrix (`t.diagnostic`, a markdown table) and fails with a
 * one-line summary of the failing cells.
 */

/** A site's bounds. `edge` sites (a car across a ramp's side or lip, over its back wall) have no pose to judge: the hubs straddle a step, so no pitch, roll or tilt is the right one (the clearance, hull, wall and slide bounds hold). */
type Bounds = {
  /** Tyre clearance within ±this (m) of the ground: further below is sunk; within it the tyre rests on the ground. */
  gap: number;
  /** The hull rests on the ground when some underside point is within this (m) of it. A car at rest with no tyre and no hull point
   *  resting floats; one resting on its hull alone (high-centred across an edge, its tyres hanging) is held by it. */
  hull: number;
  /** Deepest underside point in the ground (m). */
  pen: number;
  /** Deepest underside point in a wall (m): a car pushed clear of a ramp's side is 0. */
  overlap: number;
  /** Body tilt from the ground normal, and pitch / roll error against the ground under the hubs (deg). The ground under the hubs
   *  need not be one plane: tilt, pitch and roll each also get `spread` (deg: the most a hub's ground normal differs from the mean
   *  one, a curved crest or a bend under the car) added, and pitch / roll the twist `atan(warp / (2 · lever))` (a body rests on any
   *  three hubs, so with one hub `warp` m off the plane of the other three it may sit that far off the mean pitch / roll). */
  pose: number;
  /** Most the car's rigid centre may move over the ground (m): a body turning about a lifted centre swings its origin without sliding (`drop`). */
  slide: number;
};
const PLAIN: Bounds = { gap: 0.02, hull: 0.02, pen: 0.01, overlap: 0.02, pose: 1.5, slide: 0.5 };
export const BOUNDS = { plain: PLAIN, edge: { ...PLAIN, pose: Infinity } } as const;
export type Kind = keyof typeof BOUNDS;

export type Heading = readonly [label: string, yaw: number];
export type Run = readonly [heading: string, cell: Cell];
export type Site = { name: string; kind: Kind; classes: readonly VehicleClassId[]; runs: (cls: VehicleClassId) => Run[] };

/** Every 45° (yaw: forward = (sin yaw, 0, cos yaw)). */
export const COMPASS: readonly Heading[] = Array.from({ length: 8 }, (_, k): Heading => [`${k * 45}°`, (k * Math.PI) / 4]);
/** Offsets from a road's direction (yaw added to its own): along it, a little off line, across it either way, and back. */
export const ALONG: readonly Heading[] = [
  ["t+0°", 0],
  ["t+15°", 15 / DEG],
  ["t-15°", -15 / DEG],
  ["t+90°", Math.PI / 2],
  ["t-90°", -Math.PI / 2],
  ["t+180°", Math.PI],
];

/**
 * Body tilt (deg) past which a car has rolled onto its side or roof. It rests there, so no tyre, pose or slide bound applies (its
 * tyres are metres up), but its hull must still not be in the ground or a wall: a car lying inside a ramp is a failure.
 */
const ROLLED = 60;

export function judge(kind: Kind, r: Cell): string[] {
  const b = BOUNDS[kind];
  const flags: string[] = [];
  // A face the car lies on yields by its crush (`Fit.crush`): the stock-face probes read that much too deep.
  if (r.pen > b.pen + r.crush) flags.push("pen");
  if (r.overlap > b.overlap + r.crush) flags.push("overlap");
  if (r.tilt > ROLLED) return flags;
  if (r.gaps.some((g) => g < -b.gap)) flags.push("sunk");
  // At rest, the body is held by whatever rests on the ground: a tyre, or the hull (a belly across an edge with the tyres hanging, a
  // keel on the floor). Nothing resting is a float.
  if (!r.gaps.some((g) => Math.abs(g) <= b.gap) && !(r.hull <= b.hull)) flags.push("float");
  if (r.tilt > b.pose + r.spread) flags.push("tilt");
  if (Math.abs(r.pitch - r.groundPitch) > b.pose + r.spread + Math.atan(r.warp / (2 * r.wheelbase)) * DEG) flags.push("pitch");
  if (Math.abs(r.roll - r.groundRoll) > b.pose + r.spread + Math.atan(r.warp / (2 * r.track)) * DEG) flags.push("roll");
  if (r.slide > b.slide) flags.push("slide");
  return flags;
}

/** Run every cell of `sites`, print the matrix, and fail when any cell breaks its bounds. */
export function report(t: TestContext, sites: readonly Site[]): void {
  const rows = [MATRIX_HEAD];
  const counts = new Map<string, number>();
  const failing: string[] = [];
  let cells = 0;
  let edge = 0;
  let rolled = 0;
  for (const site of sites) {
    for (const cls of site.classes) {
      const label = cls === "sedan" ? site.name : `${site.name} (${cls})`;
      for (const [heading, r] of site.runs(cls)) {
        cells++;
        if (site.kind === "edge" && r.tilt <= ROLLED) edge++;
        if (r.tilt > ROLLED) rolled++;
        const flags = judge(site.kind, r);
        rows.push(matrixRow(label, heading, r, flags.join(" ")));
        if (flags.length === 0) continue;
        failing.push(`${label} ${heading}: ${flags.join("+")}`);
        for (const f of flags) counts.set(f, (counts.get(f) ?? 0) + 1);
      }
    }
  }
  const summary = `${failing.length} of ${cells} cells fail${failing.length ? ` (${[...counts].map(([f, n]) => `${f} ${n}`).join(", ")})` : ""}; pose unjudged on ${edge} edge cells (hubs straddle a step); ${rolled} cells rolled past ${ROLLED}° (judged on the hull only)`;
  t.diagnostic(`\n${rows.join("\n")}`);
  t.diagnostic(summary);
  assert.ok(failing.length === 0, `${summary}: ${failing.slice(0, 12).join("; ")}${failing.length > 12 ? "; …" : ""}`);
}
