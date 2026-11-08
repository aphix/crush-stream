import { describe, expect, it } from "vitest";
import type { PrefabId } from "./catalog.ts";
import { PREFAB, TRACK_ID } from "./constants.ts";
import type { Placed } from "./placements.ts";
import { biomeLookup } from "./scenery.ts";
import { COURSE_JSON, REACH, REACH_SLACK, dress, footprintDepth, nearOpening, type Dressed } from "./scenery.test-util.ts";
import { SCENERY_ASSETS } from "./scenery-assets/index.ts";
import { assetPrefab } from "./scenery-assets/pick.ts";
import type { AssetKind, SceneryAsset } from "./scenery-assets/types.ts";
import { parseTrack } from "./track-schema.ts";
import { assertSameDigest } from "../vehicle/test-support.ts";

/** The least share of a city's road paint (decals whose rule paints roads) whose footprint overlaps a road. */
const ON_ROAD_SHARE = 0.8;
/** The most (m) a solid standee's or cross's footprint may differ from its core share of the drawn width. */
const CORE_TOL = 1e-6;

type Standing = Placed & { asset: number };

/** An asset kind's drawing prefab when it has no body, and when it is solid (a decal or tile has no solid form). */
const DRAWN_AS: Record<AssetKind, PrefabId> = { card: PREFAB.assetCard, cross: PREFAB.assetCross, box: PREFAB.assetBox, decal: PREFAB.assetDecal, tile: PREFAB.assetTile };
const SOLID_AS: Record<AssetKind, PrefabId> = { card: PREFAB.assetStandee, cross: PREFAB.assetCrossSolid, box: PREFAB.assetBoxSolid, decal: PREFAB.assetDecal, tile: PREFAB.assetTile };

function dressedCourses(): Dressed[] {
  return COURSE_JSON.map((j) => dress(j));
}

/** What a course's dressing placed from the asset rows, solid and drawn. */
function standing(d: Dressed): Standing[] {
  return [...d.solid, ...d.drawn].filter((p): p is Standing => p.asset !== undefined);
}

const isPaint = (a: SceneryAsset): boolean => a.kind === "decal" || a.kind === "tile";
const paintsRoads = (a: SceneryAsset): boolean => a.kind === "decal" && (a.rule === "paving" || a.rule === "trackside" || a.rule === "yard");

/** What a placement proves a course can place: an asset rule and kind standing in a biome. */
const pairKey = (a: SceneryAsset, biome: string): string => `${a.rule}:${a.kind}:${biome}`;

/** Ids of the assets none of whose rule, kind and biome pairs any course places, and how many pairs the courses place in all. */
function unreached(): { ids: string[]; pairs: number } {
  const reached = new Set<string>();
  for (const d of dressedCourses()) {
    const biomeAt = biomeLookup(d.track);
    for (const p of standing(d)) {
      const a = SCENERY_ASSETS[p.asset];
      if (a) reached.add(pairKey(a, biomeAt(p.x, p.z)));
    }
  }
  return { ids: SCENERY_ASSETS.filter((a) => !a.biomes.some((b) => reached.has(pairKey(a, b)))).map((a) => a.id), pairs: reached.size };
}

/** Where a placed asset's prefab is not its row's drawing, or its row names no such biome, over every course. */
function misdrawn(): { seen: number; bad: string[] } {
  const bad: string[] = [];
  let seen = 0;
  for (const d of dressedCourses()) {
    const biomeAt = biomeLookup(d.track);
    for (const p of standing(d)) {
      seen++;
      const a = SCENERY_ASSETS[p.asset];
      if (!a) {
        bad.push(`${d.track.id} asset index ${p.asset} names no row`);
        continue;
      }
      const want = a.body === "solid" ? SOLID_AS[a.kind] : DRAWN_AS[a.kind];
      if (p.prefab !== assetPrefab(a) || p.prefab !== want) bad.push(`${d.track.id} ${a.id} is drawn as ${p.prefab}, not ${want}`);
      if (!a.biomes.some((b) => b === biomeAt(p.x, p.z))) bad.push(`${d.track.id} ${a.id} stands in ${biomeAt(p.x, p.z)}, not ${a.biomes.join("/")}`);
    }
  }
  return { seen, bad };
}

/** The assets with no body that are not paint (they stand only beyond a car's reach) that a car can reach, and how many stand. */
function reachable(): { seen: number; bad: string[] } {
  const bad: string[] = [];
  let seen = 0;
  for (const d of dressedCourses()) {
    for (const p of standing(d)) {
      const a = SCENERY_ASSETS[p.asset];
      if (!a || isPaint(a) || (a.body !== "none" && a.body !== "knock")) continue;
      seen++;
      if (nearOpening(d.track, p.x, p.z, REACH - REACH_SLACK)) bad.push(`${d.track.id} ${a.id} at (${p.x.toFixed(1)}, ${p.z.toFixed(1)}) is within a car's reach`);
    }
  }
  return { seen, bad };
}

/** Solid assets per course, and those a car cannot reach or whose standee or cross footprint is not its core share of the drawn width. */
function solids(): { total: number; counts: string[]; bad: string[] } {
  const counts: string[] = [];
  const bad: string[] = [];
  let total = 0;
  for (const d of dressedCourses()) {
    const solid = d.solid.filter((p): p is Standing => p.asset !== undefined);
    counts.push(`${d.track.id} ${solid.length}`);
    total += solid.length;
    for (const p of solid) {
      const a = SCENERY_ASSETS[p.asset];
      if (!nearOpening(d.track, p.x, p.z, REACH + REACH_SLACK)) bad.push(`${d.track.id} solid ${a?.id} at (${p.x.toFixed(1)}, ${p.z.toFixed(1)}) is out of a car's reach`);
      if (!a || (p.prefab !== PREFAB.assetStandee && p.prefab !== PREFAB.assetCrossSolid)) continue;
      const drawnWidth = (a.size[0] * p.sy) / a.size[1];
      if (Math.abs(p.sz - drawnWidth * a.core) > CORE_TOL) bad.push(`${d.track.id} ${a.id} is ${p.sz.toFixed(3)} m across, its core share of ${drawnWidth.toFixed(3)} m is ${(drawnWidth * a.core).toFixed(3)} m`);
    }
  }
  return { total, counts, bad };
}

/** The city's road paint (decals whose rule paints roads) and the part of it that overlaps a road. */
function cityPaint(): { paint: number; onRoad: number } {
  const d = dress(COURSE_JSON.find((j) => parseTrack(j).id === TRACK_ID.city));
  const paint = standing(d).filter((p) => {
    const a = SCENERY_ASSETS[p.asset];
    return a !== undefined && paintsRoads(a);
  });
  return { paint: paint.length, onRoad: paint.filter((p) => footprintDepth(d.track, p) > 0).length };
}

describe("given the generated scenery assets on every course", () => {
  // Weights pick among a pair's assets, so a rare asset may miss a small course set: the row holds each asset's rule, kind and a biome
  // to what some course places (circuit: oval, park: rally, city: city, desert: stunt, dirt: dam-spine), not each asset to a hit.
  // mutation: sed -i 's/const LOT_CHANCE = 0.4;/const LOT_CHANCE = 0;/' src/game/world/scenery.ts
  it("when every course is dressed, then every registered asset's rule, kind and one of its biomes is placed by some course", () => {
    const { ids, pairs } = unreached();
    const unweighted = SCENERY_ASSETS.filter((a) => a.weight <= 0).map((a) => a.id);
    expect(SCENERY_ASSETS.length, "assets registered").toBeGreaterThan(0);
    expect(pairs, "rule, kind and biome pairs placed").toBeGreaterThan(0);
    expect(ids, `assets no course can place: ${ids.join(", ")}`).toHaveLength(0);
    expect(unweighted, `assets with no weight, which no lattice picks: ${unweighted.join(", ")}`).toHaveLength(0);
  });

  // mutation: sed -i 's/return PREFAB.assetTile;/return PREFAB.assetBox;/' src/game/world/scenery-assets/pick.ts
  it("when each placed asset is read back, then its index names a row, it is drawn as its row says and it stands in a biome its row lists", () => {
    const { seen, bad } = misdrawn();
    expect(seen, "assets placed").toBeGreaterThan(0);
    expect(bad, "assets drawn as the wrong prefab or standing in the wrong biome").toHaveLength(0);
  });

  // mutation: sed -i 's/near.openGap < OPEN_REACH) return false;/near.openGap < -OPEN_REACH) return false;/' src/game/world/scenery.ts
  it("when an asset with no body (a card, a cross or a box that is not paint) is placed, then no car can reach it", () => {
    const { seen, bad } = reachable();
    expect(seen, "bodiless assets placed").toBeGreaterThan(0);
    expect(bad, "bodiless assets within a car's reach").toHaveLength(0);
  });

  // mutation: sed -i 's/h \* k, w \* a.core \* k\]/h * k, w * k]/' src/game/world/scenery-assets/pick.ts
  it("when the solid assets are measured, then each is within a car's reach and a standee's or cross's footprint is its core share of the drawn width", () => {
    const { total, counts, bad } = solids();
    expect(total, "solid assets placed").toBeGreaterThan(0);
    expect(bad, `solid assets per course: ${counts.join(", ")}`).toHaveLength(0);
  });

  // mutation: sed -i 's/const dice = unit(mix(seed, 0));/const dice = Math.random();/' src/game/world/scenery.ts
  it("when every course is dressed twice from separate parses, then the placed assets come out the same, asset index included", () => {
    let seen = 0;
    for (const j of COURSE_JSON) {
      const a = standing(dress(j));
      seen += a.length;
      assertSameDigest(a, standing(dress(structuredClone(j), { density: {} })), `${parseTrack(j).id} assets`);
    }
    expect(seen, "assets placed").toBeGreaterThan(0);
  });

  // mutation: sed -i 's/const half = p.half\[k\]!;/const half = p.half[k]! + 60;/' src/game/world/scenery.ts
  it("when the city is dressed, then its road paint lies on its roads", () => {
    const { paint, onRoad } = cityPaint();
    expect(paint, "road paint standing in the city").toBeGreaterThan(0);
    expect(onRoad / paint, `${onRoad} of ${paint} paint decals overlap a road`).toBeGreaterThanOrEqual(ON_ROAD_SHARE);
  });
});

describe("given the family rows read from JSON", () => {
  it("when each row is read, then its kind, body, rule, biomes, size, weight and core are in range and its id is unique and family-prefixed", () => {
    // mutation: sed -i 's/"weight": 0.9/"weight": 9/' src/game/world/scenery-assets/greenery.json
    const KINDS: readonly string[] = ["card", "cross", "decal", "tile", "box"];
    const BODIES: readonly string[] = ["none", "poof", "knock", "solid"];
    const RULES: readonly string[] = ["verge", "islands", "frontage", "paving", "trackside", "carpark", "yard", "ground"];
    const BIOMES: readonly string[] = ["city", "park", "circuit", "dirt", "desert"];
    const seen = new Set<string>();
    for (const a of SCENERY_ASSETS) {
      const bad = [!KINDS.includes(a.kind) && "kind", !BODIES.includes(a.body) && "body", !RULES.includes(a.rule) && "rule", !a.biomes.length && "biomes", a.biomes.some((b) => !BIOMES.includes(b)) && "biome", a.size.length !== 2 && "size", !(a.size[0] > 0 && a.size[1] > 0) && "size > 0", !(a.weight >= 0 && a.weight <= 1) && "weight", !(a.core >= 0.15 && a.core <= 1) && "core", !a.id.startsWith(`${a.family}-`) && "prefix", seen.has(a.id) && "duplicate"].filter(Boolean);
      expect(bad, a.id).toEqual([]);
      seen.add(a.id);
    }
  });
});
