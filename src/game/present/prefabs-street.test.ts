import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { PREFABS } from "../world/catalog.ts";
import { PREFAB } from "../world/constants.ts";
import { plainMaterials } from "./prefab-materials.test-util.ts";
import { prefabParts } from "./prefabs.ts";

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
