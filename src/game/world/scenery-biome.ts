import type { PrefabId } from "./catalog.ts";
import { BIOME, BIOME_IDS, PREFAB, SURFACE, type BiomeId } from "./constants.ts";
import type { Track } from "./track.ts";

/** How each biome of the scenery service is classified and dressed: the tables `scenery.ts`'s rules read. */

/** `BIOME_IDS` index of each biome (a road segment stores its biome as one byte). */
export const BIOME_INDEX = Object.fromEntries(BIOME_IDS.map((id, i) => [id, i])) as Record<BiomeId, number>;

const PAVED: ReadonlySet<string> = new Set([SURFACE.concrete, SURFACE.asphalt, SURFACE.cobble]);
const LOOSE: ReadonlySet<string> = new Set([SURFACE.dirt, SURFACE.gravel, SURFACE.mud]);

/**
 * The biome of a road stretch from its terrain and surfaces: sand terrain is desert, paved terrain a city, dirt terrain or a loose
 * road a dirt track, a grass course with a paved run-off a circuit, any other grass a park.
 */
export function defaultBiome(terrain: string, road: string, run: string): BiomeId {
  if (terrain === SURFACE.sand) return BIOME.desert;
  if (PAVED.has(terrain)) return BIOME.city;
  if (terrain === SURFACE.dirt || LOOSE.has(road)) return BIOME.dirt;
  return PAVED.has(run) ? BIOME.circuit : BIOME.park;
}

/** A weighted choice: the prefab and its share, in order. */
type Kinds = readonly (readonly [PrefabId, number])[];

/** The prefab `u` (in [0, 1)) picks from `kinds` by share. */
export function pickKind(kinds: Kinds, u: number): PrefabId {
  let left = u;
  for (let i = 0; i < kinds.length; i++) {
    left -= kinds[i]![1];
    if (left < 0) return kinds[i]![0];
  }
  return kinds[kinds.length - 1]![0];
}

type VergeSpec = {
  /** Share of the lattice cells (`VERGE_CELL`) that hold a prop. */
  chance: number;
  /** The band beyond the wall line (m) the props stand in. */
  inner: number;
  outer: number;
  kinds: Kinds;
};

/**
 * Rule 3, the verge: trees, rocks, bushes and palms beyond the wall line, by biome. Chances are shares of 14 m lattice cells (one
 * jittered prop per cell at most), tuned by eye against the courses' own scatter: a park reads as lined with trees, a desert
 * as sparse rock, palm and scrub.
 */
export const VERGE: Partial<Record<BiomeId, VergeSpec>> = {
  city: { chance: 0.04, inner: 4, outer: 30, kinds: [[PREFAB.tree, 0.6], [PREFAB.bush, 0.4]] },
  park: { chance: 0.16, inner: 6, outer: 50, kinds: [[PREFAB.tree, 0.6], [PREFAB.bush, 0.25], [PREFAB.rock, 0.08], [PREFAB.flowers, 0.07]] },
  circuit: { chance: 0.09, inner: 8, outer: 40, kinds: [[PREFAB.tree, 0.5], [PREFAB.bush, 0.5]] },
  dirt: { chance: 0.1, inner: 6, outer: 54, kinds: [[PREFAB.rock, 0.5], [PREFAB.tree, 0.3], [PREFAB.bush, 0.2]] },
  desert: { chance: 0.06, inner: 8, outer: 70, kinds: [[PREFAB.rock, 0.5], [PREFAB.palm, 0.2], [PREFAB.bush, 0.3]] },
};

/** The widest verge band (m) and the largest chance of the table above, so the lattice sweep can skip a cell early. */
export const VERGE_REACH = 70;
export const VERGE_CHANCE_MAX = 0.16;

/**
 * Rule 2, the lamps: metres between lamps along a road in each biome. A city's follows its frontage (`bayLamps`); beyond town
 * the spacing grows with openness, to a desert's 72 m, about what the fog leaves of a lamp.
 */
export const LAMP_SPACING: Partial<Record<BiomeId, number>> = { city: 28, circuit: 36, park: 48, dirt: 64, desert: 72 };

/** Rule 1: the biomes whose roads are edged with slabs, and each slab's width in sidewalk widths (a town's 2.4 m pavement, a circuit's 6 m apron). */
export const SLAB_WIDTH: Partial<Record<BiomeId, number>> = { city: 1, circuit: 2.5 };

/** Rule 4, medians and islands: per biome the share of 10 m lattice cells inside a loop that holds a bed or bush, and what stands there (a town's and a park's flower beds, a dirt track's and a desert's scrub). */
export const ISLANDS: Partial<Record<BiomeId, { chance: number; kinds: Kinds }>> = {
  city: { chance: 0.12, kinds: [[PREFAB.flowers, 0.5], [PREFAB.bush, 0.5]] },
  park: { chance: 0.12, kinds: [[PREFAB.flowers, 0.5], [PREFAB.bush, 0.5]] },
  circuit: { chance: 0.12, kinds: [[PREFAB.flowers, 0.5], [PREFAB.bush, 0.5]] },
  dirt: { chance: 0.03, kinds: [[PREFAB.bush, 1]] },
  desert: { chance: 0.03, kinds: [[PREFAB.bush, 1]] },
};
/** The largest of those chances, so the lattice sweep can skip a cell early. */
export const ISLAND_CHANCE_MAX = 0.12;

/** A biome box of the course's `scenery.zones`. */
export type Zone = { x0: number; z0: number; x1: number; z1: number; biome: BiomeId };

export function zonesOf(track: Track): Zone[] {
  return (track.json.scenery?.zones ?? []).map((z) => ({ x0: Math.min(z.x0, z.x1), x1: Math.max(z.x0, z.x1), z0: Math.min(z.z0, z.z1), z1: Math.max(z.z0, z.z1), biome: z.biome }));
}

/** The biome of the first zone holding (x, z), or null. */
export function zoneAt(zones: readonly Zone[], x: number, z: number): BiomeId | null {
  for (let i = 0; i < zones.length; i++) {
    const zn = zones[i]!;
    if (x >= zn.x0 && x <= zn.x1 && z >= zn.z0 && z <= zn.z1) return zn.biome;
  }
  return null;
}

/** Spacing (m) of the points a `noGen` stretch is held to (its `within` is far wider). */
const STRETCH_STEP = 10;

/**
 * Whether (x, z) lies in a `noGen` box, circle or stretch (the race loop between two nodes, and `within` m of it). Built once from
 * the course; a stretch is the loop's samples between the two nodes' arc lengths, one every `STRETCH_STEP` m.
 */
export function noGenOf(track: Track): (x: number, z: number) => boolean {
  const list = track.json.scenery?.noGen ?? [];
  const boxes = list.filter((n): n is Extract<typeof n, { x0: number }> => "x0" in n);
  const circles = list.filter((n): n is Extract<typeof n, { r: number }> => "r" in n);
  const stretches = list
    .filter((n): n is Extract<typeof n, { fromNode: number }> => "fromNode" in n)
    .map((n) => {
      const p = track.path;
      const s0 = track.nodeS[n.fromNode]!;
      const s1 = track.nodeS[n.toNode]!;
      const pts: number[] = [];
      let arc = 0;
      let last = -Infinity;
      for (let k = 0; k < p.count; k++) {
        const inside = s0 <= s1 ? arc >= s0 && arc <= s1 : arc >= s0 || arc <= s1;
        if (inside && arc - last >= STRETCH_STEP) {
          pts.push(p.x[k]!, p.z[k]!);
          last = arc;
        }
        const b = (k + 1) % p.count;
        arc += Math.sqrt((p.x[b]! - p.x[k]!) ** 2 + (p.z[b]! - p.z[k]!) ** 2);
      }
      return { pts, within: n.within };
    });
  return (x, z) => {
    for (const b of boxes) if (x >= Math.min(b.x0, b.x1) && x <= Math.max(b.x0, b.x1) && z >= Math.min(b.z0, b.z1) && z <= Math.max(b.z0, b.z1)) return true;
    for (const c of circles) if ((x - c.x) ** 2 + (z - c.z) ** 2 <= c.r * c.r) return true;
    for (const s of stretches) for (let i = 0; i < s.pts.length; i += 2) if ((x - s.pts[i]!) ** 2 + (z - s.pts[i + 1]!) ** 2 <= s.within * s.within) return true;
    return false;
  };
}
