import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { must } from "../kernel/must.test-util.ts";
import { facadeStyle } from "../present/facades.ts";
import { plainMaterials } from "../present/prefab-materials.test-util.ts";
import { prefabParts } from "../present/prefabs.ts";
import { COOLING_TOWER, PREFABS, SMOKESTACK, type PrefabId } from "./catalog.ts";
import { triangles } from "./collider-drawn.test-util.ts";
import { PREFAB } from "./constants.ts";
import { boxClear, placeProps, propColliders, type Placed } from "./placements.ts";
import { overlap } from "./scenery.test-util.ts";
import { Track } from "./track.ts";
import { parseTrack } from "./track-schema.ts";
import { TRACKS } from "./tracks/index.ts";

/** Nearest (m) a plant prop's footprint may come to any road or run-off: the generator's keep-out for the course. */
const ROAD_KEEP_OUT = 8;
/** East of the loop's outer wall line (x 572), where the edge's crates and barriers stand. */
const EAST_EDGE_X = 580;

const json = TRACKS.find((j) => parseTrack(j).id === "breaker-yard");
must(json, "the race menu lists breaker-yard");
const track = new Track(json);
const props = parseTrack(json).props;
const placed = placeProps(track);
/** The course's authored props, as placed: the plant's are among them. */
const authored = placed.slice(0, props.length);
const PLANT: readonly string[] = [PREFAB.coolingTower, PREFAB.smokestack, PREFAB.building];
const plant = authored.filter((p) => PLANT.includes(p.prefab));
const ofKind = (list: readonly Placed[], id: PrefabId): Placed[] => list.filter((p) => p.prefab === id);

/** The drawn vertices of a prefab as (radius, height) pairs. */
function drawnRadii(id: PrefabId): { r: number; y: number }[] {
  const out: { r: number; y: number }[] = [];
  for (const part of prefabParts(id, plainMaterials(new THREE.MeshBasicMaterial()))) {
    const t = triangles(part.geometry);
    for (let i = 0; i < t.length; i += 3) out.push({ r: Math.hypot(t[i]!, t[i + 2]!), y: t[i + 1]! });
  }
  return out;
}

/** The widest drawn radius (m) of vertices within `band` m of height `y`. */
const radiusAt = (id: PrefabId, y: number, band: number): number => Math.max(...drawnRadii(id).filter((v) => Math.abs(v.y - y) <= band).map((v) => v.r));
const heightOf = (id: PrefabId): number => Math.max(...drawnRadii(id).map((v) => v.y));

describe("given breaker-yard's plant (two cooling towers where the Havana spires stood, a smokestack, four warehouse halls)", () => {
  // mutation: sed -i 's/collider: coolingTowerPlan(), foot/collider: [], foot/' src/game/world/catalog.ts
  it("when the first two props are read, then they are cooling towers at the original's places, each with a circle collider from the ground up as wide as its base", () => {
    expect(props.map((p) => p.prefab).includes("monument"), "a Havana spire left in the course").toBe(false);
    const towers = ofKind(authored.slice(0, 2), PREFAB.coolingTower);
    expect(towers.map((t) => [t.x, t.z]), "the two slots of the old spires").toEqual([[250, -42], [355, -48]]);
    for (const tower of towers) {
      const foot = propColliders([tower]).find((c) => c.base <= tower.y + 0.01);
      must(foot, `a collider at the foot of the tower at (${tower.x}, ${tower.z})`);
      expect(foot.kind, "plinth collider shape").toBe("circle");
      expect(foot.hx, "plinth collider radius").toBeGreaterThanOrEqual(COOLING_TOWER.base - 0.5);
      expect(foot.top - foot.base, "plinth collider height").toBeGreaterThanOrEqual(3);
    }
  });

  // mutation: sed -i 's/waist: 12,/waist: 18.5,/' src/game/world/catalog.ts
  it("when the tower is drawn, then it is a hyperboloid 45 to 55 m tall: 16 to 20 m at the base, 11 to 13 m at the waist, 13 to 15 m at the open top", () => {
    const id = PREFAB.coolingTower;
    expect(heightOf(id), "height").toBeGreaterThanOrEqual(45);
    expect(heightOf(id), "height").toBeLessThanOrEqual(55);
    const [base, waist, top] = [radiusAt(id, 2, 2.1), radiusAt(id, 0.7 * COOLING_TOWER.height, 1.2), radiusAt(id, COOLING_TOWER.height, 0.1)];
    expect([base >= 16 && base <= 20, waist >= 11 && waist <= 13, top >= 13 && top <= 15], `radii base ${base.toFixed(1)}, waist ${waist.toFixed(1)}, top ${top.toFixed(1)}`).toEqual([true, true, true]);
  });

  // mutation: sed -i 's/height: 66,/height: 6,/' src/game/world/catalog.ts
  it("when the smokestack is read, then one stands 60 to 70 m tall and 4 m or more across at the foot, beside the western hall, with a collider from the ground up", () => {
    const [stack] = ofKind(authored, PREFAB.smokestack);
    must(stack, "a smokestack among the authored props");
    expect(Math.hypot(stack.x - 96, stack.z + 46), "its place (m from (96, -46))").toBeLessThan(6);
    expect(heightOf(PREFAB.smokestack), "height").toBeGreaterThanOrEqual(60);
    expect(heightOf(PREFAB.smokestack), "height").toBeLessThanOrEqual(70);
    expect(2 * radiusAt(PREFAB.smokestack, 1, 1), "diameter at the foot").toBeGreaterThanOrEqual(4);
    const foot = propColliders([stack]).find((c) => c.base <= stack.y + 0.01);
    must(foot, "a collider at the foot of the stack");
    expect(foot.hx, "footing collider radius").toBeGreaterThanOrEqual(SMOKESTACK.base - 0.1);
  });

  // mutation: sed -i 's/^        60,$/        600,/' src/game/world/tracks/breaker-yard.json
  it("when the plant's props are measured against every road and run-off, then each footprint stands 8 m or more clear, and every hall is a slab 36 m or more long on the axes", () => {
    expect(plant.length, "towers, stack and halls").toBeGreaterThanOrEqual(7);
    for (const p of plant) {
      const [hw, hd] = footprintHalf(p);
      const clear = Math.min(...track.paths().map((path) => boxClear(path, p.x, p.z, p.yaw, hw, hd)));
      expect(clear, `${p.prefab} at (${p.x.toFixed(0)}, ${p.z.toFixed(0)}) to the nearest road`).toBeGreaterThanOrEqual(ROAD_KEEP_OUT);
    }
    const halls = ofKind(plant, PREFAB.building);
    expect(halls.length, "halls").toBeGreaterThanOrEqual(4);
    for (const h of halls) {
      expect(Math.max(...footprintHalf(h)) * 2, `hall at (${h.x}, ${h.z}) long side`).toBeGreaterThanOrEqual(36);
      expect(Math.sin(2 * h.yaw), `hall at (${h.x}, ${h.z}) yaw`).toBeCloseTo(0, 6);
    }
  });

  // mutation: sed -i '172,175s/"x": 250,/"x": 270,/' src/game/world/tracks/breaker-yard.json
  it("when the plant's footprints are compared with every other authored prop (the yard, scatter, lamps), then none overlaps another", () => {
    for (const p of plant) {
      for (const q of authored) if (q !== p) expect(overlap(p, q), `${p.prefab} at (${p.x.toFixed(0)}, ${p.z.toFixed(0)}) overlaps ${q.prefab} at (${q.x.toFixed(1)}, ${q.z.toFixed(1)})`).toBe(false);
    }
  });

  // mutation: sed -i 's/"prefab": "barrier-block",/"prefab": "cone",/' src/game/world/tracks/breaker-yard.json
  it("when the east edge is read, then crates and jersey barriers stand outside the loop's east leg, behind its wall", () => {
    const edge = authored.filter((p) => p.x >= EAST_EDGE_X);
    expect(ofKind(edge, PREFAB.crate).length, "crates").toBeGreaterThanOrEqual(25);
    expect(ofKind(edge, PREFAB.barrierBlock).length, "jersey barriers").toBeGreaterThanOrEqual(15);
  });

  // mutation: sed -i '435s/"z": -385,/"z": -384,/' src/game/world/tracks/breaker-yard.json
  it("when the halls' facades are picked, then each draws in the warehouse style", () => {
    for (const h of ofKind(plant, PREFAB.building)) {
      const size = PREFABS[h.prefab].size;
      const style = facadeStyle(h.prefab, h.x, h.z, "dirt", Math.max(h.sx, h.sz) * size[0], h.sy * size[1]);
      expect(style, `hall at (${h.x}, ${h.z})`).toBe("warehouse");
    }
  });
});

/** Half extents (m) of a placement's drawn footprint along its local x and z. */
function footprintHalf(p: Placed): [number, number] {
  const size = PREFABS[p.prefab].size;
  return [(size[0] * p.sx) / 2, (size[2] * p.sz) / 2];
}
