import { describe, expect, it } from "vitest";
import { PARKED_PREFABS, PREFABS } from "./catalog.ts";
import { BIOME, PREFAB, TRACK_ID } from "./constants.ts";
import { placeProps, type Placed } from "./placements.ts";
import { addedDrawGroups, biomeLookup, drawGroupOf, thinScenery } from "./scenery.ts";
import { COURSE_JSON, FLAT, REACH, REACH_SLACK, centreDistance, dress, intrusion, keyOf, nearOpening, overlap, seamGap } from "./scenery.test-util.ts";
import { parseTrack } from "./track-schema.ts";
import { Track, blankPoint } from "./track.ts";
import { TRACKS } from "./tracks/index.ts";
import { assertSameDigest } from "../vehicle/test-support.ts";

/** The most (m) a generated footprint may reach onto a road or run-off: the course-intrusion bar. */
const TOL = 0.1;
/** The least (m) between a generated lamp and a hand lamp: a city's 28 m spacing times the share of it a hand lamp lights. */
const LIT_MIN = 16;


const json = (id: string): unknown => COURSE_JSON.find((j) => parseTrack(j).id === id)!;
const OVAL = json(TRACK_ID.oval);

describe("given every course", () => {
  it("when it is dressed twice from separate parses, then both lists come out the same", () => {
    for (const j of COURSE_JSON) {
      const a = dress(j);
      const b = dress(structuredClone(j), { density: {} });
      assertSameDigest(a.solid, b.solid, `${a.track.id} solid`);
      assertSameDigest(a.drawn, b.drawn, `${a.track.id} drawn`);
    }
  });

  it("when its props are listed, then the authored ones come first, unmoved, and the solid scenery follows them", () => {
    for (const j of COURSE_JSON) {
      const d = dress(j);
      const listed = placeProps(d.track);
      assertSameDigest(listed.slice(0, d.authored.length), d.authored, `${d.track.id} authored prefix`);
      expect(listed.length, `${d.track.id} solid scenery after the chevrons`).toBe(d.authored.length + d.solid.length);
    }
  });

  it("when the drawn-only list is thinned to three effects tiers, then each lower tier is a strict subset of the one above", () => {
    const d = dress(json(TRACK_ID.fourCount));
    const tiers = [1, 0.6, 0.3].map((share) => new Set(thinScenery(d.drawn, share).map(keyOf)));
    expect(tiers[0]!.size, "the top tier draws all").toBe(d.drawn.length);
    for (let i = 1; i < tiers.length; i++) {
      expect(tiers[i]!.size, `tier ${i} is smaller`).toBeLessThan(tiers[i - 1]!.size);
      for (const key of tiers[i]!) expect(tiers[i - 1]!.has(key), `${key} in tier ${i} and not above`).toBe(true);
    }
  });

  it("when the drawn-only list is thinned to the cheapest tier, then every sidewalk slab is still drawn (the apron stays whole)", () => {
    const d = dress(json(TRACK_ID.fourCount));
    const slabs = d.drawn.filter((p) => p.prefab === PREFAB.sidewalk).length;
    expect(slabs, "the course has an apron").toBeGreaterThan(0);
    expect(thinScenery(d.drawn, 0.3).filter((p) => p.prefab === PREFAB.sidewalk).length).toBe(slabs);
  });
  // mutation: sed -i 's/p.prefab === PREFAB.sidewalk || unit(/unit(/' src/game/world/scenery.ts
});

describe("given the scenery on every course", () => {
  it("when each generated footprint is measured against every road and run-off, then none reaches onto one", () => {
    const bad: string[] = [];
    for (const j of COURSE_JSON) {
      const d = dress(j);
      for (const p of [...d.solid, ...d.drawn]) if (intrusion(d.track, p) > TOL) bad.push(`${d.track.id} ${p.prefab} at (${p.x.toFixed(1)}, ${p.z.toFixed(1)}) reaches ${intrusion(d.track, p).toFixed(2)} m onto a road`);
    }
    expect(bad).toEqual([]);
  });

  it("when a prop with a body is drawn only, then no open road edge lies within the verge reach of it; and every solid one has one within it", () => {
    const bad: string[] = [];
    for (const j of COURSE_JSON) {
      const d = dress(j);
      for (const p of d.drawn) if (PREFABS[p.prefab].body !== "none" && nearOpening(d.track, p.x, p.z, REACH - REACH_SLACK)) bad.push(`${d.track.id} drawn ${p.prefab} at (${p.x.toFixed(1)}, ${p.z.toFixed(1)}) is within a car's reach`);
      for (const p of d.solid) if (!nearOpening(d.track, p.x, p.z, REACH + REACH_SLACK)) bad.push(`${d.track.id} solid ${p.prefab} at (${p.x.toFixed(1)}, ${p.z.toFixed(1)}) is out of a car's reach`);
    }
    expect(bad).toEqual([]);
  });

  it("when a generated footprint is measured against every authored prop and every other generated one, then none overlaps", () => {
    const bad: string[] = [];
    for (const j of COURSE_JSON) {
      const d = dress(j);
      const made = [...d.solid, ...d.drawn].filter((p) => !FLAT.has(p.prefab));
      for (const [i, p] of made.entries()) {
        const other = [...d.authored, ...made.slice(i + 1)].find((q) => overlap(p, q));
        if (other) bad.push(`${d.track.id} ${p.prefab} at (${p.x.toFixed(1)}, ${p.z.toFixed(1)}) overlaps a ${other.prefab}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it("when the sidewalk slabs along the oval's and the city's bends are measured, then no seam between neighbouring slabs opens 0.1 m", () => {
    const SEAM_MAX = 0.1;
    const NEIGHBOURS = 8;
    const BEND_RADIUS = 60;
    const NEAR_BEND = 40;
    for (const id of [TRACK_ID.oval, TRACK_ID.city]) {
      const d = dress(json(id));
      const path = d.track.path;
      const bends: number[] = [];
      for (let k = 0; k < path.count; k++) if (Math.abs(path.curv[k]!) * BEND_RADIUS > 1) bends.push(k);
      const slabs = d.drawn.filter((p) => p.prefab === PREFAB.sidewalk);
      const bad: string[] = [];
      let measured = 0;
      for (let i = 1; i < slabs.length; i++) {
        const [a, b] = [slabs[i - 1]!, slabs[i]!];
        // Two listed slabs further apart than this are not neighbours (a crossing road, a bridge or the next road side lies between).
        if (Math.hypot(a.x - b.x, a.z - b.z) >= NEIGHBOURS) continue;
        const [mx, mz] = [(a.x + b.x) / 2, (a.z + b.z) / 2];
        if (!bends.some((k) => Math.hypot(path.x[k]! - mx, path.z[k]! - mz) < NEAR_BEND)) continue;
        measured++;
        const seam = seamGap(a, b);
        if (seam >= SEAM_MAX) bad.push(`${id} slabs at (${a.x.toFixed(1)}, ${a.z.toFixed(1)}) and (${b.x.toFixed(1)}, ${b.z.toFixed(1)}) leave a ${seam.toFixed(2)} m seam`);
      }
      expect(measured, `${id} slab pairs measured on its bends`).toBeGreaterThan(50);
      expect(bad).toEqual([]);
    }
  });

  it("when a generated lamp is measured against the authored lamps, then none stands within the stretch a hand lamp lights", () => {
    const bad: string[] = [];
    for (const j of COURSE_JSON) {
      const d = dress(j);
      const hand = d.authored.filter((p) => p.prefab === PREFAB.lamp);
      for (const p of [...d.solid, ...d.drawn].filter((q) => q.prefab === PREFAB.lamp)) {
        const near = Math.min(...hand.map((h) => Math.hypot(h.x - p.x, h.z - p.z)));
        if (near < LIT_MIN) bad.push(`${d.track.id} lamp at (${p.x.toFixed(1)}, ${p.z.toFixed(1)}) is ${near.toFixed(1)} m from a hand lamp`);
      }
    }
    expect(bad).toEqual([]);
  });
});

describe("given each course family", () => {
  const BIOMES: [string, string][] = [
    [TRACK_ID.oval, BIOME.circuit],
    [TRACK_ID.rally, BIOME.park],
    [TRACK_ID.city, BIOME.city],
    [TRACK_ID.stunt, BIOME.desert],
    [TRACK_ID.fourCount, BIOME.park],
    [TRACK_ID.damSpine, BIOME.dirt],
    [TRACK_ID.razorShelf, BIOME.dirt],
    [TRACK_ID.breakerYard, BIOME.dirt],
    ["figure-8", BIOME.dirt],
    [TRACK_ID.nationalMall, BIOME.none],
    ["havana", BIOME.none],
  ];

  it.each(BIOMES)("when %s's start line is classified, then its biome is %s", (id, biome) => {
    const track = new Track(json(id));
    const at = track.pointAt(0, blankPoint());
    expect(biomeLookup(track)(at.x, at.z)).toBe(biome);
  });

  it("when the Mall's town-house corner and the rest of the Mall are classified, then only the corner is a city", () => {
    const track = new Track(json(TRACK_ID.nationalMall));
    const lookup = biomeLookup(track);
    expect(lookup(-1700, -900)).toBe(BIOME.city);
    expect(lookup(-500, -300)).toBe(BIOME.none);
  });

  it("when the Mall and Havana are dressed, then Havana has no scenery and the Mall's stands inside its corner box", () => {
    expect(dress(json("havana")).drawn.length + dress(json("havana")).solid.length).toBe(0);
    const mall = dress(json(TRACK_ID.nationalMall));
    const made: Placed[] = [...mall.solid, ...mall.drawn];
    expect(made.length).toBeGreaterThan(100);
    for (const p of made) expect(p.x > -2160 && p.x < -1180 && p.z > -1310 && p.z < -540, `${p.prefab} at (${p.x.toFixed(0)}, ${p.z.toFixed(0)}) is outside the corner`).toBe(true);
  });

  it("when a city and a circuit are dressed, then they have sidewalks, and the oval's has tyre stacks, parked cars and flower beds", () => {
    const kinds = (id: string) => new Set([...dress(json(id)).solid, ...dress(json(id)).drawn].map((p) => p.prefab));
    expect(kinds(TRACK_ID.city).has(PREFAB.sidewalk)).toBe(true);
    for (const kind of [PREFAB.sidewalk, PREFAB.tyreStack, PREFAB.flowers]) expect(kinds(TRACK_ID.oval).has(kind), `the oval has ${kind}`).toBe(true);
    expect([...PARKED_PREFABS].some((id) => kinds(TRACK_ID.oval).has(id)), "the oval parks cars").toBe(true);
  });
});

describe("given a course's scenery block", () => {
  const base = dress(OVAL);
  const all = [...base.solid, ...base.drawn];
  const keys = new Set(all.map(keyOf));
  const subset = (d: ReturnType<typeof dress>): boolean => [...d.solid, ...d.drawn].every((p) => keys.has(keyOf(p)));

  it("when a no-gen box is laid over a prop, then nothing is generated inside it and the rest is a subset of the default", () => {
    const at = all[Math.floor(all.length / 2)]!;
    const box = { x0: at.x - 6, z0: at.z - 6, x1: at.x + 6, z1: at.z + 6 };
    const d = dress(OVAL, { noGen: [box] });
    const made = [...d.solid, ...d.drawn];
    expect(made.length).toBeLessThan(all.length);
    expect(made.filter((p) => p.x >= box.x0 && p.x <= box.x1 && p.z >= box.z0 && p.z <= box.z1)).toEqual([]);
    expect(subset(d)).toBe(true);
  });

  it("when a no-gen circle and a no-gen stretch of the loop are laid, then nothing is generated in them", () => {
    const at = all[Math.floor(all.length / 3)]!;
    const circle = dress(OVAL, { noGen: [{ x: at.x, z: at.z, r: 15 }] });
    expect([...circle.solid, ...circle.drawn].filter((p) => Math.hypot(p.x - at.x, p.z - at.z) <= 15)).toEqual([]);
    const stretch = dress(OVAL, { noGen: [{ fromNode: 0, toNode: 6, within: 40 }] });
    const reach = (d: ReturnType<typeof dress>) => [...d.solid, ...d.drawn].filter((p) => stretchDistance(d.track, p) < 30).length;
    expect(reach(base), "the default has scenery along the stretch").toBeGreaterThan(0);
    expect(reach(stretch)).toBe(0);
  });

  it("when the clear distance is raised, then every prop stands that far from every centreline and the list is a subset of the default", () => {
    const d = dress(OVAL, { clear: 30 });
    const made = [...d.solid, ...d.drawn];
    expect(made.length).toBeLessThan(all.length);
    for (const p of made) expect(centreDistance(d.track, p.x, p.z), `${p.prefab} at (${p.x.toFixed(1)}, ${p.z.toFixed(1)})`).toBeGreaterThanOrEqual(30 - 0.01);
    expect(subset(d)).toBe(true);
  });

  it("when a rule is switched off, then none of its props stand, and the others are unchanged", () => {
    const d = dress(OVAL, { off: ["paving"] });
    const made = [...d.solid, ...d.drawn];
    expect(made.filter((p) => p.prefab === PREFAB.sidewalk)).toEqual([]);
    expect(made.length).toBeLessThan(all.length);
    expect(subset(d)).toBe(true);
  });

  it("when the course names its biome a city, then its roads get sidewalks the width of a pavement, not the circuit's apron", () => {
    const pavement = (d: ReturnType<typeof dress>) => d.drawn.find((p) => p.prefab === PREFAB.sidewalk)!.sx;
    expect(pavement(dress(OVAL, { biome: BIOME.city }))).toBe(1.5);
    expect(pavement(base)).toBeGreaterThan(1);
  });

  it("when a density is named for a rule that reads none, then the course is rejected; and a density of 0 for one that does takes its props out", () => {
    expect(() => parseTrack(Object.assign({}, OVAL, { scenery: { density: { paving: 2 } } }))).toThrow();
    expect(() => parseTrack(Object.assign({}, OVAL, { scenery: { density: { trackside: 0 } } }))).toThrow();
    const d = dress(OVAL, { density: { islands: 0 } });
    const made = [...d.solid, ...d.drawn];
    expect(made.length).toBeLessThan(all.length);
    expect(subset(d)).toBe(true);
  });
});

/** Distance (m) from a placement to the loop's samples between node 0 and node 6, the stretch the no-gen row blanks. */
function stretchDistance(track: Track, p: Placed): number {
  const pt = blankPoint();
  let best = Infinity;
  for (let s = track.nodeS[0]!; s <= track.nodeS[6]!; s += 5) {
    track.pointAt(s, pt);
    best = Math.min(best, Math.hypot(pt.x - p.x, pt.z - p.z));
  }
  return best;
}

describe("given the scenery's cost on every course", () => {
  // mutation: sed -i 's/const DRAWS_MAX = 160;/const DRAWS_MAX = 1;/' src/game/world/scenery.test.ts
  it("when the draw cells of the generated props are counted, then each course adds few draws and no cell holds too many of one kind", () => {
    // Before assets four-count added 45 (a long course over many 512 m draw cells, six kinds in each). An asset's group is its prefab and
    // family in a cell, so the assets took the most to 153 groups (dam-spine; four-count 143, the Mall 61), capped here with a little room
    // (owner, 2026-11-08: land at the measured figure, cut draws later if the phone benches show it). Measured per-frame draw calls, whole
    // course in view, headless high / low tier, before -> after the assets: dam-spine 270 -> 379 / 264 -> 368, four-count 245 -> 331 /
    // 236 -> 317, the Mall 595 -> 636 / 591 -> 629 (triangles +1-3k: many small instanced groups, not geometry).
    const DRAWS_MAX = 160;
    const PER_CELL_MAX = 2000;
    for (const j of TRACKS) {
      const d = dress(j);
      // The solid props join the authored props' groups; the drawn-only ones are drawn apart (`TrackArt.scenery`), each group its own draw.
      const added = addedDrawGroups(d.authored, d.solid, d.drawn);
      expect(added, `${d.track.id} adds ${added} prefab-cell groups`).toBeLessThanOrEqual(DRAWS_MAX);
      const cells = new Map<string, number>();
      for (const p of [...d.solid, ...d.drawn]) cells.set(drawGroupOf(p), (cells.get(drawGroupOf(p)) ?? 0) + 1);
      for (const [key, n] of cells) expect(n, `${d.track.id} ${key}`).toBeLessThanOrEqual(PER_CELL_MAX);
    }
  });
});
