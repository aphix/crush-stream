import { describe, expect, it } from "vitest";
import type { PrefabId } from "./catalog.ts";
import { PREFAB, TRACK_ID } from "./constants.ts";
import type { Placed } from "./placements.ts";
import { biomeLookup } from "./scenery.ts";
import { COURSE_JSON, REACH, REACH_SLACK, dress, footprintDepth, nearOpening, type Dressed } from "./scenery.test-util.ts";
import { SCENERY_ASSETS } from "./scenery-assets/index.ts";
import { assetPrefab } from "./scenery-assets/pick.ts";
import { ROAD_DECAL_ASSET, ROAD_DECAL_NAMES, type AssetKind, type SceneryAsset } from "./scenery-assets/types.ts";
import { parseTrack } from "./track-schema.ts";
import { assertSameDigest } from "../vehicle/test-support.ts";

/** The least (m) a manhole cover's nearest neighbour is, at the median: one every 60 to 80 m along a road, closer only where two roads meet. */
const MANHOLE_APART = 40;
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

/** What a placement proves a course can place: an asset rule and kind standing in a biome. */
const pairKey = (a: SceneryAsset, biome: string): string => `${a.rule}:${a.kind}:${biome}`;

/** Ids of the assets none of whose rule, kind and biome pairs any course places, and how many pairs the courses place in all. */
function unreached(): { ids: string[]; pairs: number } {
  const reached = new Set<string>();
  // The road paint is a course's opt-in: the city and the oval are dressed again with every kind listed.
  const optedIn = [TRACK_ID.city, TRACK_ID.oval].map((id) => dress(COURSE_JSON.find((j) => parseTrack(j).id === id), { roadDecals: [...ROAD_DECAL_NAMES] }));
  for (const d of [...dressedCourses(), ...optedIn]) {
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

const cityJson = (): unknown => COURSE_JSON.find((j) => parseTrack(j).id === TRACK_ID.city);

/** The generated decals and tiles standing in `d` whose footprint overlaps a road or its run-off (those on a car park slab are not on a road). */
function onRoad(d: Dressed): Standing[] {
  return standing(d).filter((p) => isPaint(SCENERY_ASSETS[p.asset]!) && footprintDepth(d.track, p) > 0);
}

const idOf = (p: Standing): string => SCENERY_ASSETS[p.asset]!.id;

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

  // mutation: sed -i 's/?? \[{ name: DEFAULT_ROAD_DECAL, only: BIOME.city }\]/?? ROAD_DECAL_NAMES.map((name) => ({ name, only: null }))/' src/game/world/scenery.ts
  it("when every course is dressed with no roadDecals, then the only generated paint on a road is a manhole cover on the city's", () => {
    let manholes = 0;
    for (const d of dressedCourses()) {
      const ids = onRoad(d).map(idOf);
      expect(ids.filter((id) => id !== ROAD_DECAL_ASSET.manhole), `${d.track.id} paint on a road`).toEqual([]);
      if (d.track.id !== TRACK_ID.city) expect(ids, `${d.track.id} paint on a road`).toEqual([]);
      manholes += ids.length;
    }
    expect(manholes, "manhole covers on the city's roads").toBeGreaterThan(0);
  });

  // mutation: sed -i 's/const asset = SCENERY_ASSETS.findIndex((a) => a.id === ROAD_DECAL_ASSET\[name\]);/const asset = SCENERY_ASSETS.findIndex((a) => a.id === ROAD_DECAL_ASSET.manhole);/' src/game/world/scenery.ts
  it("when a course lists its road paint, then only those kinds lie on its roads, and an empty list lays none", () => {
    expect(onRoad(dress(cityJson(), { roadDecals: [] })).map(idOf), "an empty list").toEqual([]);
    const crosswalks = onRoad(dress(cityJson(), { roadDecals: ["crosswalk"] })).map(idOf);
    expect(crosswalks.length, "crosswalks on the city's roads").toBeGreaterThan(0);
    expect(crosswalks.filter((id) => id !== ROAD_DECAL_ASSET.crosswalk), "other paint on a road").toEqual([]);
  });

  // mutation: sed -i 's/manhole: 70/manhole: 10/' src/game/world/scenery.ts
  it("when the city's manhole covers are measured, then most have their nearest neighbour a cover's spacing away", () => {
    const covers = onRoad(dress(cityJson())).filter((p) => idOf(p) === ROAD_DECAL_ASSET.manhole);
    expect(covers.length, "covers").toBeGreaterThan(0);
    // Two roads meeting put a pair closer, so the median of the nearest-neighbour distances is the measure.
    const nearest = covers.map((a) => Math.min(...covers.filter((b) => b !== a).map((b) => Math.hypot(a.x - b.x, a.z - b.z)))).sort((x, y) => x - y);
    const median = nearest[Math.floor(nearest.length / 2)]!;
    expect(median, `the median nearest cover is ${median.toFixed(1)} m away`).toBeGreaterThanOrEqual(MANHOLE_APART);
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
