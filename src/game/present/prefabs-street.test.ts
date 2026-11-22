import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { PREFABS } from "../world/catalog.ts";
import { PREFAB } from "../world/constants.ts";
import { plainMaterials } from "./prefab-materials.test-util.ts";
import { prefabParts } from "./prefabs.ts";
import { stubBrowser } from "../engine/engine-headless.test-util.ts";
import { LAMP_POOL } from "./constants.ts";
import { makeLamp } from "./engine-world.ts";
import { ROAD_LIFT } from "./track-mesh.ts";
import { LAMP_FROM_CURB, LAYOUT } from "../world/openworld/openworld-constants.ts";

/** A sprite card is 2 triangles: a piece with a shape of its own has at least a box's 12. */
const SHAPE_TRIANGLES_MIN = 12;
/** The most triangles one piece may take: a city's hundred-odd pieces stay under 40 000 for the lot. */
const PIECE_TRIANGLES_MAX = 400;
/** A bike rack with its bicycle (a diamond frame of rods, two ring tyres, a saddle, a chainring, pedals) takes more. */
const BIKE_RACK_TRIANGLES_MAX = 600;
/** Slack (m) on a piece's box: float rounding of the drawn vertices. */
const BOX_SLACK = 1e-5;

/** The plaza is one per course: its two stone rings and statue may take more. */
const PLAZA_TRIANGLES_MAX = 800;
/** A pool corner this near (m) a band's cut is the cut's own, shared by the bands either side of it. */
const CUT_SLACK = 1e-4;

const KIT = [
  PREFAB.bench,
  PREFAB.bikeRack,
  PREFAB.litterBin,
  PREFAB.parkingMeter,
  PREFAB.hydrant,
  PREFAB.cafeSet,
  PREFAB.busShelter,
  PREFAB.busStopSign,
  PREFAB.streetSign,
  PREFAB.bollard,
  PREFAB.cellarDoor,
  PREFAB.hoopFence,
  PREFAB.pavilion,
  PREFAB.plaza,
] as const;

/** Distinct vertex colours of a geometry. */
function coloursOf(geometry: THREE.BufferGeometry): number {
  const colour = geometry.getAttribute("color");
  const seen = new Set<string>();
  for (let vertex = 0; vertex < colour.count; vertex++) seen.add(`${colour.getX(vertex)},${colour.getY(vertex)},${colour.getZ(vertex)}`);
  return seen.size;
}

describe("given the open world's street kit", () => {
  const mats = plainMaterials(new THREE.MeshBasicMaterial());

  for (const id of KIT) {
    // mutation: sed -i 's/  \[PREFAB.hydrant\]: hydrant,/  [PREFAB.hydrant]: litterBin,/' src/game/present/prefabs-street.ts
    it(`when the ${id} is built, then it is one painted shape of its own, inside the box the catalogue gives it, under the triangle budget`, () => {
      const parts = prefabParts(id, mats);
      expect(parts.length, id === PREFAB.bikeRack ? "the shape and the wheels' spoke sprites" : "one part").toBe(id === PREFAB.bikeRack ? 2 : 1);
      const geometry = parts[0]!.geometry;
      const triangles = geometry.getAttribute("position").count / 3;
      expect(triangles, "triangles").toBeGreaterThanOrEqual(SHAPE_TRIANGLES_MIN);
      expect(triangles, "triangles").toBeLessThanOrEqual(id === PREFAB.plaza ? PLAZA_TRIANGLES_MAX : id === PREFAB.bikeRack ? BIKE_RACK_TRIANGLES_MAX : PIECE_TRIANGLES_MAX);
      expect(coloursOf(geometry), "colours it is painted in").toBeGreaterThanOrEqual(1);
      const bounds = new THREE.Box3();
      for (const part of parts) {
        part.geometry.computeBoundingBox();
        bounds.union(part.geometry.boundingBox!);
      }
      const [alongFront, up, across] = PREFABS[id].size;
      expect(Math.max(-bounds.min.x, bounds.max.x), "reach along its front (m)").toBeLessThanOrEqual(alongFront / 2 + BOX_SLACK);
      expect(Math.max(-bounds.min.z, bounds.max.z), "reach along the curb (m)").toBeLessThanOrEqual(across / 2 + BOX_SLACK);
      expect(bounds.min.y, "foot (m)").toBeGreaterThanOrEqual(-BOX_SLACK);
      expect(bounds.max.y, "top (m)").toBeLessThanOrEqual(up + BOX_SLACK);
    });
  }
});

describe("given a street lamp's night pool, an additive decal on the ground", () => {
  // mutation: sed -i 's/^  pool.position.set(0, 0.004, ahead);/  pool.position.set(0, 0.025, ahead);/' src/game/present/engine-world.ts
  it("when an arm lamp and an acorn lamp are built, then the pool lies within 5 mm of the ground, under a lying body's lowest part, so it does not cut a stripe across one", () => {
    stubBrowser();
    for (const acorn of [false, true]) {
      const pool = makeLamp(true, acorn).getObjectByName(LAMP_POOL) as THREE.Mesh;
      expect(pool.position.y, `${acorn ? "acorn" : "arm"} lamp's pool height (m)`).toBeLessThanOrEqual(0.005);
      expect(pool.position.y, `${acorn ? "acorn" : "arm"} lamp's pool height (m)`).toBeGreaterThan(0);
    }
  });

  /** The heights (m) of the drawn pool's corners of `id` that lie past the kerb at x `kerb` (over the road, +x) and short of x `ground` (on plain ground), the cut's own corners left out. */
  const bands = (id: typeof PREFAB.lamp | typeof PREFAB.acornLamp, kerb: number, ground: number): { road: number[]; low: number[] } => {
    stubBrowser();
    const pool = prefabParts(id, plainMaterials(new THREE.MeshBasicMaterial())).find((part) => part.shared && part.material.blending === THREE.AdditiveBlending)!;
    const position = pool.geometry.getAttribute("position");
    const road: number[] = [];
    const low: number[] = [];
    for (let at = 0; at < position.count; at++) {
      if (position.getX(at) > kerb + CUT_SLACK) road.push(position.getY(at));
      else if (position.getX(at) < ground - CUT_SLACK) low.push(position.getY(at));
    }
    return { road, low };
  };

  // mutation: sed -i 's/geometry: geo.translate(0, ROAD_LIFT, 0), material/geometry: geo, material/' src/game/present/prefabs.ts
  it("when a race lamp's pool is drawn, then every corner of it lies above the road ribbons' lift, onto the depth proxy it is tested against, whichever side of the lamp a road runs", () => {
    const { road } = bands(PREFAB.lamp, -Infinity, -Infinity);
    expect(road.length, "corners of the pool").toBeGreaterThan(0);
    expect(Math.min(...road), "lowest corner of the pool (m)").toBeGreaterThan(ROAD_LIFT);
  });

  // mutation: sed -i 's/cutX(pool, LAMP_FROM_CURB, Infinity).translate(0, ROAD_LIFT, 0)/cutX(pool, LAMP_FROM_CURB, Infinity)/' src/game/present/prefabs.ts
  it("when the open world's street lamp's pool is drawn, then its band over the street lies above the road ribbons' lift and its band over the lot stays within 5 mm of the ground", () => {
    const { road, low } = bands(PREFAB.acornLamp, LAMP_FROM_CURB, LAMP_FROM_CURB - LAYOUT.sidewalk);
    expect(road.length, "corners over the street").toBeGreaterThan(0);
    expect(Math.min(...road), "lowest corner over the street (m)").toBeGreaterThan(ROAD_LIFT);
    expect(low.length, "corners over the lot").toBeGreaterThan(0);
    expect(Math.max(...low), "highest corner over the lot (m)").toBeLessThanOrEqual(0.005);
  });
});
