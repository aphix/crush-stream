import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { PARKED_CARS, PARKED_PREFABS, PREFABS } from "../world/catalog.ts";
import { PREFAB, TRACK_ID } from "../world/constants.ts";
import { placeCourse, propColliders } from "../world/placements.ts";
import { COURSE_JSON, dress } from "../world/scenery.test-util.ts";
import { parseTrack } from "../world/track-schema.ts";
import { Track } from "../world/track.ts";
import { CAR_STYLES } from "../vehicle/car-variants.ts";
import { plainMaterials } from "./prefab-materials.test-util.ts";
import { prefabParts } from "./prefabs.ts";
import { PropTumble } from "./prop-tumble.ts";
import { drawCell } from "./track-mesh.ts";

/**
 * The car parks behind a circuit's grandstands park real cars: each style's own meshes decimated once into one instanced draw per style
 * (`parkedCar`), drawn only (no collider, out of the map), the style and paint picked by the bay's hash.
 */

const oval = COURSE_JSON.find((j) => parseTrack(j).id === TRACK_ID.oval)!;
const material = new THREE.MeshBasicMaterial();
const mats = plainMaterials(material);
/** The most triangles a parked car draws: a clustered shell, four glass quads, bumpers and four 8-sided prism tyres (a wreck stand-in was 36, a whole car is 7000 to 9000; measured 540 to 860). */
const PARKED_TRIANGLES = 1000;
/** How far (m) a parked car's drawn box may differ from the style's own dimensions (the grid merge takes the roof crown's top centimetres). */
const BOX_SLACK = 0.12;

describe("given the oval's car parks", () => {
  const parked = dress(oval).drawn.filter((p) => PARKED_PREFABS.has(p.prefab));

  it("when the oval is dressed, then its bays hold parked-car prefabs, no wreck stand-in, drawn only with no collider", () => {
    // mutation: sed -i 's/const { prefab } = PARKED_CARS\[Math.floor(unit(mix(bay, 1)) \* PARKED_CARS.length)\]!;/const prefab = PREFAB.wreck;/' src/game/world/scenery.ts
    expect(parked.length, "parked cars on the oval").toBeGreaterThan(40);
    expect(dress(oval).drawn.filter((p) => p.prefab === PREFAB.wreck).length, "wreck stand-ins").toBe(0);
    expect(dress(oval).solid.filter((p) => PARKED_PREFABS.has(p.prefab)).length, "parked cars with a body").toBe(0);
    for (const { prefab } of PARKED_CARS) expect([PREFABS[prefab].body, PREFABS[prefab].collider.length], prefab).toEqual(["none", 0]);
    expect(propColliders(placeCourse(new Track(parseTrack(oval))).placed).filter((c) => c.prefab !== null && PARKED_PREFABS.has(c.prefab)).length, "colliders on parked cars").toBe(0);
  });

  it("when the oval is dressed twice, then every bay picks the same style and the lots hold several styles", () => {
    // mutation: sed -i 's/unit(mix(bay, 1))/Math.random()/' src/game/world/scenery.ts
    // mutation: sed -i 's/Math.floor(unit(mix(bay, 1)) \* PARKED_CARS.length)/0/' src/game/world/scenery.ts
    const again = placeCourse(new Track(parseTrack(oval))).drawn.filter((p) => PARKED_PREFABS.has(p.prefab));
    expect(again.map((p) => `${p.prefab}@${p.x},${p.z}`).join(), "bays").toBe(parked.map((p) => `${p.prefab}@${p.x},${p.z}`).join());
    expect(new Set(parked.map((p) => p.prefab)).size, "styles parked").toBeGreaterThanOrEqual(4);
  });

  it("when the parked cars are drawn, then each style is one instanced draw per draw cell, all in the one scenery material", () => {
    // mutation: sed -i 's/return one(parkedCar("sedan"), mats.plain);/return [...one(parkedCar("sedan"), mats.plain), ...one(parkedCar("sedan"), mats.plain)];/' src/game/present/prefabs.ts
    const meshes: THREE.InstancedMesh[] = [];
    new PropTumble(parked, mats, (mesh) => meshes.push(mesh));
    const groups = new Set(parked.map((p) => `${p.prefab}@${drawCell(p.x, p.z)}`));
    expect(meshes.length, "draws").toBe(groups.size);
    expect(new Set(meshes.map((m) => m.material)).size, "materials").toBe(1);
    expect(meshes.reduce((n, m) => n + m.count, 0), "instances").toBe(parked.length);
  });
});

describe("given each parked car", () => {
  for (const car of PARKED_CARS) {
    it(`when the ${car.style} is built, then it is one cheap clustered mesh of its style's size, nose +Z, standing on the ground`, () => {
      // mutation: sed -i 's/body: { shape: 0.32/body: { shape: 0.02/' src/game/present/prefabs-car.ts
      // mutation: sed -i 's/wide: 1.64, long: 4.229/wide: 1.64, long: 3.0/' src/game/world/catalog.ts
      const parts = prefabParts(car.prefab, mats);
      expect(parts.length, "parts").toBe(1);
      const geometry = parts[0]!.geometry;
      expect(geometry.index ? geometry.index.count / 3 : geometry.getAttribute("position").count / 3, "triangles").toBeLessThanOrEqual(PARKED_TRIANGLES);
      const box = new THREE.Box3().setFromBufferAttribute(geometry.getAttribute("position") as THREE.BufferAttribute);
      const size = box.getSize(new THREE.Vector3());
      expect(Math.abs(size.x - car.wide), "width").toBeLessThan(BOX_SLACK);
      expect(Math.abs(size.y - car.tall), "height").toBeLessThan(BOX_SLACK);
      expect(Math.abs(size.z - car.long), "length").toBeLessThan(BOX_SLACK);
      expect(Math.abs(box.min.y), "ground").toBeLessThan(0.01);
      expect(Math.abs(box.min.z + box.max.z) / 2, "centred").toBeLessThan(0.1);
    });

    it(`when the ${car.style}'s catalog box is read, then it is the style's own width, length and height`, () => {
      // mutation: sed -i 's/wide: 1.64, long: 4.229/wide: 1.64, long: 3.0/' src/game/world/catalog.ts
      const { dims } = CAR_STYLES[car.style];
      expect([car.wide, car.long, car.tall].join(), "box").toBe([dims.width, dims.overhang.front + dims.wheelbase + dims.overhang.rear, dims.height].map((v) => Math.round(v * 1e3) / 1e3).join());
      expect(PREFABS[car.prefab].size.join(), "catalog size").toBe([car.wide, car.tall, car.long].join());
    });
  }
});
