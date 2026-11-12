import { beforeAll, describe, expect, it } from "vitest";
import { detCos, detSin } from "../../kernel/physics-core.js";
import { stubBrowser } from "../../engine/engine-headless.test-util.ts";
import { makePrefabMaterials, prefabParts, raceTextures } from "../../present/prefabs.ts";
import type { PrefabMaterials } from "../../present/prefab-pieces.ts";
import { PREFABS } from "../catalog.ts";
import { PREFAB } from "../constants.ts";
import { BAY_WIDTH, SHOPFRONT } from "./interior-kinds.ts";
import { drawnHalf } from "./openworld-facade-solids.ts";
import { openWorldCourse } from "./openworld-course.ts";
import { ENVELOPE_HEIGHT } from "./openworld-interior-solids.ts";
import { layOutLots } from "./openworld-lots.ts";

const lots = layOutLots();
const props = openWorldCourse(lots).props!;
const envelope = props.filter((prop) => prop.prefab === PREFAB.invisibleWall && prop.size![1] === ENVELOPE_HEIGHT);
/** The street wall on each side of a doorway, a shared party wall, and a share of the merged back wall. */
const PIECES_PER_PLACE = 4;
const furnished = lots.places.slice(0, lots.backdropStart).filter((place) => place.interior !== undefined);

/** Whether (x, z) lies inside an envelope piece: size [thickness, height, length], its length along z turned by the yaw. */
function walled(x: number, z: number): boolean {
  return envelope.some((prop) => {
    const [thickness, , length] = prop.size!;
    const yaw = prop.yaw ?? 0;
    const dx = x - prop.x;
    const dz = z - prop.z;
    return Math.abs(dx * detCos(yaw) - dz * detSin(yaw)) < thickness / 2 && Math.abs(dx * detSin(yaw) + dz * detCos(yaw)) < length / 2;
  });
}

/** The point `across` m along the place's front from its middle and `deep` m in from its drawn street face. */
function inside(place: (typeof furnished)[number], across: number, deep: number): { x: number; z: number } {
  const front = drawnHalf(place.depth) - deep;
  return { x: place.x + front * detCos(place.yaw) + across * detSin(place.yaw), z: place.z - front * detSin(place.yaw) + across * detCos(place.yaw) };
}

describe("given the open world's course on the real programme", () => {
  let materials: PrefabMaterials;
  beforeAll(() => {
    stubBrowser();
    materials = makePrefabMaterials(raceTextures());
  });

  // mutation: sed -i 's/prefab: building.enterable === true ? PREFAB.buildingShell : PREFAB.building/prefab: PREFAB.building/' src/game/world/openworld/openworld-course.ts
  it("when its buildings are read, then every place with an interior stands in a drawn-only shell and every other building is the solid prop", () => {
    const shells = props.filter((prop) => prop.prefab === PREFAB.buildingShell);
    const solid = props.filter((prop) => prop.prefab === PREFAB.building);
    expect(shells.length, "enterable buildings").toBe(furnished.length);
    for (const place of furnished) expect(shells.some((shell) => Math.abs(shell.x - place.x) < 1e-6 && Math.abs(shell.z - place.z) < 1e-6 && shell.style === place.style), `${place.name} in a shell`).toBe(true);
    expect(solid.length, "solid buildings: the shops with no interior").toBe(lots.buildings.length - furnished.length);
    expect(PREFABS[PREFAB.buildingShell].body, "what a shell is").toBe("none");
    expect(PREFABS[PREFAB.buildingShell].collider.length, "a shell's colliders").toBe(0);
  });

  it("when a shell is drawn, then it is drawn exactly as a building of its style is", () => {
    const [shell] = prefabParts(PREFAB.buildingShell, materials, "coffee");
    const [building] = prefabParts(PREFAB.building, materials, "coffee");
    expect(shell!.geometry.getAttribute("position").count, "vertices").toBe(building!.geometry.getAttribute("position").count);
    expect(shell!.material, "material").toBe(building!.material);
  });

  // mutation: sed -i 's/const doorways = { ...wall, ...across, openings: street ? wall.openings.filter((opening) => opening.sill === 0) : \[\] };/const doorways = { ...wall, ...across, openings: [] };/' src/game/world/openworld/interior-plan.ts
  it("when the street face of each interior is swept at body width, then it is walled everywhere but in the doorways, which are open for a walker", () => {
    for (const place of furnished) {
      const bays = Math.round(place.width / BAY_WIDTH);
      const doors = Array.from({ length: bays }, (_, bay) => SHOPFRONT[place.interior!].map((opening) => ({ centre: opening.centre + (bay - (bays - 1) / 2) * BAY_WIDTH, half: opening.width / 2 }))).flat();
      const wrong: string[] = [];
      for (let across = -drawnHalf(place.width) + 0.1; across < drawnHalf(place.width) - 0.1; across += 0.1) {
        const open = doors.some((door) => Math.abs(across - door.centre) < door.half - 0.02);
        const shut = !doors.some((door) => Math.abs(across - door.centre) < door.half + 0.02);
        const point = inside(place, across, 0.17);
        if (open && walled(point.x, point.z)) wrong.push(`${across.toFixed(1)} walled in a doorway`);
        if (shut && !walled(point.x, point.z)) wrong.push(`${across.toFixed(1)} open in a wall`);
      }
      expect(wrong.slice(0, 3).join("; "), `${place.name} street face`).toBe("");
    }
  });

  // mutation: sed -i 's/export const ENVELOPE_HEIGHT = buildingHeight(MAX_STOREYS, true);/export const ENVELOPE_HEIGHT = 12;/' src/game/world/openworld/openworld-interior-solids.ts (the envelope of a three-storey city)
  it("when the back and the sides of each interior are probed, then a car meets a wall, and every envelope piece stands taller than every building", () => {
    const tallest = Math.max(...lots.buildings.map((building) => building.height));
    expect(Math.min(...envelope.map((prop) => prop.size![1])), "shortest envelope piece").toBeGreaterThanOrEqual(tallest);
    expect(PREFABS[PREFAB.invisibleWall].body, "what a car meets").toBe("solid");
    for (const place of furnished) {
      const back = inside(place, 0, 2 * drawnHalf(place.depth) - 0.17);
      expect(walled(back.x, back.z), `${place.name} back wall`).toBe(true);
    }
  });

  // mutation: sed -i 's/return mergeAlong(mergeAlong(columns, true), false).map(/return columns.map(/' src/game/world/openworld/openworld-interior-solids.ts (every wall of every house its own piece)
  it("when the envelope of every interior is counted, then a house costs a few pieces (its street wall either side of the door and one shared wall), not one per wall", () => {
    expect(envelope.length, "envelope pieces").toBeLessThanOrEqual(furnished.length * PIECES_PER_PLACE);
  });
});
