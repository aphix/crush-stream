import { detCos, detSin } from "../kernel/physics-core.js";
import type { PrefabId } from "./catalog.ts";
import type { BiomeId } from "./constants.ts";
import { CLUSTER_CHANCE_MAX, CLUSTER_LOOK, CLUSTERS, pickKind } from "./scenery-biome.ts";
import { buildFarField, farCell, hashString, mix, nearest, unit, type FarField, type Near, type RoadField } from "./scenery-field.ts";

/**
 * Rule 3's far clusters: clumps of plants and rocks beyond the verge, in ground no car reaches, drawn only. This file holds the clump's own
 * rules; `scenery.ts` stands each member (`ClusterWorld.stand`) and wires the sweep.
 */

/** Lattice cell (m) of the clumps, the band of wall-line gap (m) they stand in, where their share starts to thin toward the outer edge and what share is left there. */
const CLUSTER_CELL = 32;
const CLUSTER_INNER = 24;
const CLUSTER_OUTER = 300;
const CLUSTER_THIN_FROM = 110;
const CLUSTER_EDGE_SHARE = 0.25;
/** The coarse road grid's cell (m): it tells a gap `nearest` cannot see (past the road field's reach). */
const FAR_CELL = 24;
/** How far (m) past a car's reach of an open road edge a member keeps: no member is ever inside what a car can touch. */
export const CLUSTER_CLEAR = 16;
/** A clump: its members (fewest, most), its radius (m, least, most) and the share of its other members that are its lead kind. */
const CLUSTER_MEMBERS = [3, 9] as const;
const CLUSTER_RADIUS = [5, 11] as const;
const CLUSTER_LEAD = 0.55;
/** The clumps clump too: a smooth hash noise over this cell (m) scales a cell's chance from `THICKET_MIN` (a gap) to `THICKET_MAX` (a thicket), mean 1. */
const THICKET_CELL = 150;
const THICKET_MIN = 0.25;
const THICKET_MAX = 1.75;
/** A clump's biggest member stands this far from its centre as a share of the radius; the rest anywhere in it. */
const BIGGEST_OFF = 0.25;
/** The biggest member's size rank (lowest, span) against the others' (span from 0): most of a clump is smaller than its middle. */
const BIGGEST_RANK = [0.75, 0.25] as const;
const OTHER_RANK = 0.55;

/** How a far cluster member sits: tipped `lean` rad from upright, and `sink` of its height into the ground. */
export type Look = { lean: number; sink: number };

/** What the sweep needs of the scenery service: its road field and scratch, whether and in what biome a point is dressed, and how a member is stood. */
export type ClusterWorld = {
  field: RoadField;
  near: Near;
  /** The course's hash (`hashString(track.id)`). */
  seed: number;
  /** The ground a lattice sweep covers, grown by `reach` m. */
  sweepBox(reach: number): [number, number, number, number];
  dressable(x: number, z: number): boolean;
  biomeAt(x: number, z: number, seg: number): BiomeId;
  stand(prefab: PrefabId, x: number, z: number, yaw: number, sx: number, sy: number, sz: number, look: Look): boolean;
};

/** A smooth hash noise over (x, z), wide patches of thick (`THICKET_MAX`) and thin (`THICKET_MIN`): the value noise's middle stretched so a patch is mostly one or the other. */
function thicket(seed: number, x: number, z: number): number {
  const gx = x / THICKET_CELL;
  const gz = z / THICKET_CELL;
  const i = Math.floor(gx);
  const j = Math.floor(gz);
  const u = (gx - i) * (gx - i) * (3 - 2 * (gx - i));
  const v = (gz - j) * (gz - j) * (3 - 2 * (gz - j));
  const at = (a: number, b: number): number => unit(mix(seed, mix(a, b)));
  const n = (at(i, j) * (1 - u) + at(i + 1, j) * u) * (1 - v) + (at(i, j + 1) * (1 - u) + at(i + 1, j + 1) * u) * v;
  const s = Math.min(1, Math.max(0, (n - 0.3) / 0.4));
  return THICKET_MIN + (THICKET_MAX - THICKET_MIN) * s * s * (3 - 2 * s);
}

/** Member `k` of the clump at (x, z) with hash `seed`, its kind drawn from `lead` and `kinds`, stood through `w.stand`. */
function layMember(w: ClusterWorld, seed: number, k: number, x: number, z: number, radius: number, lead: PrefabId, kinds: Parameters<typeof pickKind>[0]): void {
  const m = mix(seed, 16 + k);
  const prefab = k === 0 || unit(mix(m, 0)) < CLUSTER_LEAD ? lead : pickKind(kinds, unit(mix(m, 1)));
  const look = CLUSTER_LOOK[prefab]!;
  const angle = unit(mix(m, 2)) * 2 * Math.PI;
  const off = (k === 0 ? BIGGEST_OFF : 1) * radius * Math.sqrt(unit(mix(m, 3)));
  const rank = k === 0 ? BIGGEST_RANK[0] + BIGGEST_RANK[1] * unit(mix(m, 4)) : OTHER_RANK * unit(mix(m, 4));
  const size = look.size[0] + (look.size[1] - look.size[0]) * rank;
  const sink = look.sink[0] + (look.sink[1] - look.sink[0]) * unit(mix(m, 10));
  w.stand(prefab, x + off * detSin(angle), z + off * detCos(angle), unit(mix(m, 5)) * 2 * Math.PI, size * (0.8 + 0.4 * unit(mix(m, 6))), size * (0.75 + 0.55 * unit(mix(m, 7))), size * (0.8 + 0.4 * unit(mix(m, 8))), { lean: look.lean * unit(mix(m, 9)), sink });
}

/**
 * One lattice cell's far cluster, if it holds one: a clump of 3 to 9 plants and rocks of mixed sizes about a centre, its biggest member in the middle, most of them one lead kind, each its own size on every axis, turned at random, leaning
 * a little and (a rock) sunk into the ground. The centre's gap is `nearest`'s where it sees a road, else the coarse grid's.
 */
function clusterCell(w: ClusterWorld, salt: number, density: number, far: FarField, i: number, j: number): void {
  const seed = mix(salt, mix(i, j));
  const roll = unit(mix(seed, 0));
  if (roll >= CLUSTER_CHANCE_MAX * THICKET_MAX * density) return;
  const x = (i + unit(mix(seed, 1))) * CLUSTER_CELL;
  const z = (j + unit(mix(seed, 2))) * CLUSTER_CELL;
  const cell = farCell(far, x, z);
  if (cell < 0 || far.dist[cell]! < CLUSTER_INNER - FAR_CELL || far.dist[cell]! > CLUSTER_OUTER + FAR_CELL || !w.dressable(x, z)) return;
  const near = nearest(w.field, x, z, w.near);
  const seg = near.seg >= 0 ? near.seg : far.seg[cell]!;
  const gap = near.seg >= 0 ? near.gap : far.dist[cell]!;
  if (seg < 0 || gap < CLUSTER_INNER || gap > CLUSTER_OUTER) return;
  const spec = CLUSTERS[w.biomeAt(x, z, seg)];
  const edge = Math.min(1, Math.max(0, (gap - CLUSTER_THIN_FROM) / (CLUSTER_OUTER - CLUSTER_THIN_FROM)));
  if (!spec || roll >= spec.chance * thicket(salt, x, z) * (1 - (1 - CLUSTER_EDGE_SHARE) * edge * edge * (3 - 2 * edge)) * density) return;
  const count = CLUSTER_MEMBERS[0] + Math.floor(unit(mix(seed, 3)) * (CLUSTER_MEMBERS[1] - CLUSTER_MEMBERS[0] + 1));
  const radius = CLUSTER_RADIUS[0] + unit(mix(seed, 4)) * (CLUSTER_RADIUS[1] - CLUSTER_RADIUS[0]);
  const lead = pickKind(spec.kinds, unit(mix(seed, 5)));
  for (let k = 0; k < count; k++) layMember(w, seed, k, x, z, radius, lead, spec.kinds);
}

/** The far clusters over the course's sweep grown by `CLUSTER_OUTER`: every lattice cell once, by its own hash alone (the course's and the rule's). */
export function layClusters(w: ClusterWorld, density: number): void {
  const box = w.sweepBox(CLUSTER_OUTER);
  const salt = mix(w.seed, hashString("cluster"));
  const far = buildFarField(w.field, box, FAR_CELL);
  for (let i = Math.floor(box[0] / CLUSTER_CELL); i <= Math.ceil(box[1] / CLUSTER_CELL); i++) {
    for (let j = Math.floor(box[2] / CLUSTER_CELL); j <= Math.ceil(box[3] / CLUSTER_CELL); j++) clusterCell(w, salt, density, far, i, j);
  }
}
