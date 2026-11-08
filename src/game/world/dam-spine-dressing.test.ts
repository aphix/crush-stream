import { describe, expect, it } from "vitest";
import { PREFAB } from "./constants.ts";
import { placeProps } from "./placements.ts";
import { Track, blankProjection } from "./track.ts";
import { parseTrack } from "./track-schema.ts";
import { TRACKS } from "./tracks/index.ts";
import { must } from "../kernel/must.test-util.ts";

const json = TRACKS.find((j) => parseTrack(j).id === "dam-spine");
must(json, "the race menu lists dam-spine");
const track = new Track(json);
const env = track.json.environment;

/** The loop's inside, where its one hill stands near the roads (m): x then z, from and to. */
const INTERIOR = { x0: 0, x1: 400, z0: 40, z1: 340 };
/** The nearest a plateau's foot (footprint, run and round) may come to a road or run-off (m), and a hill outside the loop to the roads in its radii. */
const PLATEAU_CLEAR = 30;
const HILL_CLEAR_RADII = 2.5;
/** The most (m) any hill lifts a road sample's base terrain: the road is stamped over it, so only its shoulder's ease sees it. */
const HILL_LIFT_MAX = 1.05;
/** A hand prop of the east-end yard stands on this level (m) and the foot of the embankment's ground, not on its face. */
const YARD = { x0: 860, x1: 960, z0: -150, z1: -40 };

/** Distance (m) from (x, z) to the nearest road or run-off edge of any path (the centreline's, less the wall line's reach). */
function roadGap(x: number, z: number): number {
  let best = Infinity;
  for (const path of track.paths()) {
    for (let k = 0; k < path.count; k++) best = Math.min(best, Math.hypot(path.x[k]! - x, path.z[k]! - z) - path.half[k]! - Math.max(path.runL[k]!, path.runR[k]!));
  }
  return best;
}

describe("given dam-spine's relief (hills, mesas and painted ground round a dam and valley that stood on a bare plain)", () => {
  it("when its plateaus are read, then there are mesas topped with gravel, each foot at least 30 m off every road and run-off", () => {
    expect(env.plateaus.length, "mesas").toBeGreaterThanOrEqual(2);
    for (const p of env.plateaus) {
      expect(p.top, `mesa at (${p.x}, ${p.z})`).toBe("gravel");
      let nearest = Infinity;
      for (const path of track.paths()) {
        for (let k = 0; k < path.count; k++) {
          const dx = Math.max(Math.abs(path.x[k]! - p.x) - (p.halfX + Math.max(p.run[0], p.run[1]) + p.round), 0);
          const dz = Math.max(Math.abs(path.z[k]! - p.z) - (p.halfZ + Math.max(p.run[2], p.run[3]) + p.round), 0);
          nearest = Math.min(nearest, Math.hypot(dx, dz) - path.half[k]! - Math.max(path.runL[k]!, path.runR[k]!));
        }
      }
      expect(nearest, `mesa at (${p.x}, ${p.z}) to the nearest road`).toBeGreaterThanOrEqual(PLATEAU_CLEAR);
    }
  });

  it("when its hills are read, then there are at least eight, six stand 2.5 radii off every road, and none outside the loop lifts a road sample more than a metre", () => {
    expect(env.hills.length, "hills").toBeGreaterThanOrEqual(8);
    expect(env.hills.filter((h) => roadGap(h.x, h.z) >= HILL_CLEAR_RADII * h.radius).length, "hills 2.5 radii off every road").toBeGreaterThanOrEqual(6);
    for (const h of env.hills) {
      if (h.x > INTERIOR.x0 && h.x < INTERIOR.x1 && h.z > INTERIOR.z0 && h.z < INTERIOR.z1) continue;
      let lift = 0;
      for (const path of track.paths()) {
        for (let k = 0; k < path.count; k++) lift = Math.max(lift, h.height * Math.exp(-((path.x[k]! - h.x) ** 2 + (path.z[k]! - h.z) ** 2) / (h.radius * h.radius)));
      }
      expect(lift, `hill at (${h.x}, ${h.z}) r ${h.radius} under the roads`).toBeLessThanOrEqual(HILL_LIFT_MAX);
    }
  });

  it("when its props are placed, then a construction yard stands on level ground inside the east-end curve: containers, a generator, crates, drums, cones, jersey blocks and a crane", () => {
    const yard = placeProps(track).filter((p) => p.x > YARD.x0 && p.x < YARD.x1 && p.z > YARD.z0 && p.z < YARD.z1);
    const count = (id: string) => yard.filter((p) => p.prefab === id).length;
    expect(count(PREFAB.dumpster), "containers and a generator").toBeGreaterThanOrEqual(4);
    expect(count(PREFAB.crate), "crates").toBeGreaterThanOrEqual(6);
    expect(count(PREFAB.tyreStack), "drums").toBeGreaterThanOrEqual(6);
    expect(count(PREFAB.cone), "cones").toBeGreaterThanOrEqual(6);
    expect(count(PREFAB.barrierBlock), "jersey blocks").toBeGreaterThanOrEqual(6);
    expect(count(PREFAB.junkCrane), "cranes").toBe(1);
    for (const p of yard) {
      expect(Math.abs(p.y), `${p.prefab} at (${p.x.toFixed(0)}, ${p.z.toFixed(0)}) stands on the ground at the embankment's foot`).toBeLessThan(0.5);
      expect(roadGap(p.x, p.z), `${p.prefab} at (${p.x.toFixed(0)}, ${p.z.toFixed(0)}) off the road`).toBeGreaterThan(20);
    }
  });

  it("when its props are placed, then delineator cones stand 3 m beyond the wall line along the embankments (nodes 0 to 7 and 24 to 52) and none on the dam deck", () => {
    const cones = placeProps(track).filter((p) => p.prefab === PREFAB.cone && roadGap(p.x, p.z) < 8);
    expect(cones.length, "delineators").toBeGreaterThanOrEqual(40);
    const proj = blankProjection();
    for (const c of cones) {
      track.project(c.x, c.z, -1, proj);
      const onEmbankment = proj.s <= track.nodeS[7]! + 40 || (proj.s >= track.nodeS[24]! - 40 && proj.s <= track.nodeS[52]! + 40);
      expect(onEmbankment && !track.path.deck[proj.k], `cone at (${c.x.toFixed(0)}, ${c.z.toFixed(0)}) at s ${proj.s.toFixed(0)}`).toBeTruthy();
    }
  });
});
