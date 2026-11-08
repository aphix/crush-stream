import { describe, expect, it } from "vitest";
import { PREFABS } from "./catalog.ts";
import { PREFAB } from "./constants.ts";
import { placeProps, propColliders } from "./placements.ts";
import { blankProjection, Track } from "./track.ts";
import { parseTrack } from "./track-schema.ts";
import { TRACKS } from "./tracks/index.ts";
import { must } from "../kernel/must.test-util.ts";

const json = TRACKS.find((j) => parseTrack(j).id === "figure-8");
must(json, "the race menu lists figure-8");
const track = new Track(json);

describe("given the figure-8's scenery (island landmarks, pines, stands, junked shells, the forest)", () => {
  it("when its props are placed, then every footprint keeps off the road and its run-off, wherever the loops and the X put them", () => {
    const proj = blankProjection();
    for (const p of placeProps(track)) {
      track.project(p.x, p.z, -1, proj);
      const k = proj.k;
      const wallLine = track.path.half[k]! + (proj.lateral > 0 ? track.path.runL[k]! : track.path.runR[k]!);
      const gap = Math.sqrt(proj.dist2) - wallLine - PREFABS[p.prefab].foot * Math.max(p.sx, p.sz);
      expect(gap, `${p.prefab} at (${p.x.toFixed(1)}, ${p.z.toFixed(1)})`).toBeGreaterThanOrEqual(0);
    }
  });

  it("when its colliders are built, then the junkyard pieces (Carhenge, the crane, every shell) are drawn only and each island holds its landmark", () => {
    const placed = placeProps(track);
    const junk = new Set<string>([PREFAB.carhenge, PREFAB.junkCrane, PREFAB.wreck]);
    const hit = propColliders(placed).filter((c) => c.prefab !== null && junk.has(c.prefab));
    expect(hit.length, "colliders on junkyard scenery").toBe(0);
    expect(placed.filter((p) => p.prefab === PREFAB.carhenge).length).toBe(1);
    expect(placed.filter((p) => p.prefab === PREFAB.junkCrane).length).toBe(1);
  });

  it("when its lamps are placed, then each loop is lit round its outer edge (outside the loop, never on its island) and four tall floodlights stand in the wedges round the X", () => {
    const lamps = placeProps(track).filter((p) => p.prefab === PREFAB.lamp);
    const floods = [[22, 0], [-22, 0], [0, 22], [0, -22]];
    for (const [x, z] of floods) {
      const at = lamps.find((p) => Math.hypot(p.x - x!, p.z - z!) < 0.01);
      expect(at, `a floodlight at (${x}, ${z})`).toBeTruthy();
      expect(at!.sy, "taller than a road lamp").toBeGreaterThan(2);
    }
    // Loop centres 42.43 m either side of the X; the road (30 m radius, 12 m half width, 1 m runoff) ends 43 m out.
    for (const sign of [1, -1]) {
      const loop = lamps.filter((p) => !floods.some(([x, z]) => Math.hypot(p.x - x!, p.z - z!) < 0.01) && Math.sign(p.z) === sign);
      expect(loop.length, `lamps round the ${sign > 0 ? "north" : "south"} loop`).toBeGreaterThanOrEqual(6);
      for (const p of loop) expect(Math.hypot(p.x, p.z - sign * 42.43), `lamp at (${p.x.toFixed(1)}, ${p.z.toFixed(1)}) outside its loop`).toBeGreaterThan(43);
    }
  });
});
