import { describe, expect, it } from "vitest";
import { hypot3 } from "../kernel/physics-core.js";
import { type GunModelId, gunModel } from "./weapon-models.ts";

/** Each gun's real length along its barrel (m), least and most, and the most triangles it may cost. */
const GUNS: readonly (readonly [id: GunModelId, least: number, most: number])[] = [
  ["pistol", 0.19, 0.23],
  ["shotgun", 0.95, 1.1],
  ["rifle", 0.9, 1.05],
  ["hook", 0.3, 0.42],
];
const MOST_TRIANGLES = 400;

/** What a model's vertices span, how many colours they carry, and how near one of them comes to the muzzle point. */
function read(id: GunModelId) {
  const { geometry, muzzle } = gunModel(id);
  const position = geometry.getAttribute("position");
  const color = geometry.getAttribute("color");
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  let nearestToMuzzle = Infinity;
  const colours = new Set<number>();
  for (let v = 0; v < position.count; v++) {
    const x = position.getX(v);
    const y = position.getY(v);
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
    nearestToMuzzle = Math.min(nearestToMuzzle, hypot3(x - muzzle[0], y - muzzle[1], position.getZ(v)));
    colours.add(Math.round(color.getX(v) * 255) * 65536 + Math.round(color.getY(v) * 255) * 256 + Math.round(color.getZ(v) * 255));
  }
  return { minX, maxX, minY, maxY, nearestToMuzzle, colours: colours.size, triangles: position.count / 3, muzzle };
}

describe("given the firearms a person can hold", () => {
  for (const [id, least, most] of GUNS) {
    it(`when the ${id} is built, then it is as long as the real thing, drawn in several colours for few triangles`, () => {
      const gun = read(id);
      expect(gun.maxX - gun.minX, "length along the barrel (m)").toBeGreaterThanOrEqual(least);
      expect(gun.maxX - gun.minX, "length along the barrel (m)").toBeLessThanOrEqual(most);
      expect(gun.colours, "distinct colours: a gun, not a block").toBeGreaterThanOrEqual(3);
      expect(gun.triangles, "triangles").toBeLessThanOrEqual(MOST_TRIANGLES);
    });

    it(`when the ${id} is held by its grip, then the hand is inside the gun and the muzzle is the barrel's very tip, ahead of the hand`, () => {
      const gun = read(id);
      expect(gun.minX < 0 && gun.maxX > 0 && gun.minY < 0 && gun.maxY > 0, "the grip point lies within the gun's side view").toBe(true);
      expect(gun.muzzle[0], "the muzzle is ahead of the hand (m)").toBeGreaterThan(0.1);
      expect(gun.maxX - gun.muzzle[0], "nothing of the gun reaches past its muzzle (m)").toBeLessThanOrEqual(0.001);
      expect(gun.nearestToMuzzle, "the muzzle point sits on the gun (m to the nearest vertex)").toBeLessThanOrEqual(0.02);
    });
  }
});
