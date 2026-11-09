import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { PREFABS, STREET_KIT } from "../world/catalog.ts";
import { PREFAB } from "../world/constants.ts";
import { plainMaterials } from "./prefab-materials.test-util.ts";
import { prefabParts } from "./prefabs.ts";

/** A sprite card is 2 triangles: a piece with a shape of its own has at least a box's 12. */
const SHAPE_TRIANGLES_MIN = 12;
/** The most triangles one piece may take: a city's hundred-odd pieces stay under 40 000 for the lot. */
const PIECE_TRIANGLES_MAX = 400;
/** Slack (m) on a piece's box: float rounding of the drawn vertices. */
const BOX_SLACK = 1e-5;

const KIT = [
  { id: PREFAB.bench, box: STREET_KIT.bench },
  { id: PREFAB.bikeRack, box: STREET_KIT.bikeRack },
  { id: PREFAB.litterBin, box: STREET_KIT.litterBin },
  { id: PREFAB.parkingMeter, box: STREET_KIT.parkingMeter },
  { id: PREFAB.hydrant, box: STREET_KIT.hydrant },
  { id: PREFAB.cafeSet, box: STREET_KIT.cafeSet },
  { id: PREFAB.busShelter, box: STREET_KIT.busShelter },
  { id: PREFAB.busStopSign, box: STREET_KIT.busStopSign },
  { id: PREFAB.streetSign, box: STREET_KIT.streetSign },
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

  for (const piece of KIT) {
    // mutation: sed -i 's/  \[PREFAB.hydrant\]: hydrant,/  [PREFAB.hydrant]: litterBin,/' src/game/present/prefabs-street.ts
    it(`when the ${piece.id} is built, then it is one painted shape of its own, inside the box the catalogue gives it, under the triangle budget`, () => {
      const parts = prefabParts(piece.id, mats);
      expect(parts.length, "one part").toBe(1);
      const geometry = parts[0]!.geometry;
      const triangles = geometry.getAttribute("position").count / 3;
      expect(triangles, "triangles").toBeGreaterThanOrEqual(SHAPE_TRIANGLES_MIN);
      expect(triangles, "triangles").toBeLessThanOrEqual(PIECE_TRIANGLES_MAX);
      expect(coloursOf(geometry), "colours it is painted in").toBeGreaterThanOrEqual(2);
      geometry.computeBoundingBox();
      const bounds = geometry.boundingBox!;
      const [alongFront, up, across] = piece.box;
      expect(Math.max(-bounds.min.x, bounds.max.x), "reach along its front (m)").toBeLessThanOrEqual(alongFront / 2 + BOX_SLACK);
      expect(Math.max(-bounds.min.z, bounds.max.z), "reach along the curb (m)").toBeLessThanOrEqual(across / 2 + BOX_SLACK);
      expect(bounds.min.y, "foot (m)").toBeGreaterThanOrEqual(-BOX_SLACK);
      expect(bounds.max.y, "top (m)").toBeLessThanOrEqual(up + BOX_SLACK);
      expect(PREFABS[piece.id].size.join(" x "), "the catalogue's box").toBe(piece.box.join(" x "));
    });
  }
});
