import { describe, expect, it } from "vitest";
import { bakeCorner, type RoomLight } from "./interior-light.ts";

/** A room 10 m deep and 6 m wide, one level, floor at 0 and ceiling at 3. */
const room = (parts: Partial<RoomLight>): RoomLight => ({ ambient: 0.05, fixtures: new Float32Array(0), fixtureCount: 0, panes: new Float32Array(0), paneCount: 0, boxes: new Float32Array(0), boxCount: 0, levels: Float32Array.of(0, 3), levelCount: 1, halfDepth: 5, halfWidth: 3, ...parts });
const LAMP = { fixtures: Float32Array.of(0, 2.65, 0, 10, 10, 10, 0), fixtureCount: 1 };
const WINDOW = { panes: Float32Array.of(5, 1.5, 0, -1, 0, 4, 0), paneCount: 1 };
/** Lamp light (the sum of r, g, b) and daylight at a corner. */
function baked(light: RoomLight, x: number, y: number, z: number, ny: number): { lamp: number; day: number } {
  const out = new Float32Array(4);
  bakeCorner(light, x, y, z, 0, ny, 0, false, out, 0);
  return { lamp: out[0]! + out[1]! + out[2]!, day: out[3]! };
}

describe("given a room 10 m deep and 6 m wide with one ceiling lamp at its middle and one window in its street wall", () => {
  // mutation: sed -i 's|    const gain = (facing \* (0.35 + 0.65 \* Math.max(0, ly / d))) / (d2 + 0.36);|    const gain = facing * (0.35 + 0.65 * Math.max(0, ly / d));|' src/game/present/interiors/interior-light.ts
  it("when the floor is baked under the lamp and 4 m from it, then the lamp's light under it is more than twice the other", () => {
    expect(baked(room(LAMP), 0, 0, 0, 1).lamp).toBeGreaterThan(2 * baked(room(LAMP), 4, 0, 0, 1).lamp);
  });

  // mutation: sed -i 's|  return 0.55 + 0.45 \* t \* t \* (3 - 2 \* t);|  return 1;|' src/game/present/interiors/interior-light.ts
  it("when a lampless room's floor is baked at a wall and at its middle, then the corner at the wall is under 0.7 of the middle's", () => {
    const dim = room({ ambient: 0.5 });
    expect(baked(dim, 5, 0, 0, 1).lamp).toBeLessThan(0.7 * baked(dim, 0, 0, 0, 1).lamp);
  });

  // mutation: sed -i 's|    day += (light.panes\[o + 5\]! \* toPane \* through) / (Math.PI \* r2 + 1);|    day += 0.5;|' src/game/present/interiors/interior-light.ts
  it("when the floor is baked 1 m from the window and 9 m from it, then the daylight near it is more than 3 times the far one", () => {
    expect(baked(room(WINDOW), 4, 0, 0, 1).day).toBeGreaterThan(3 * baked(room(WINDOW), -4, 0, 0, 1).day);
  });

  // mutation: sed -i 's/    if (facing === 0 || blocked(light, level)) continue;/    if (facing === 0) continue;/' src/game/present/interiors/interior-light.ts
  it("when a wall stands between a corner and the lamp, then that corner gets the ambient only", () => {
    const walled = room({ ...LAMP, boxes: Float32Array.of(-2.1, 0, -3, -1.9, 3, 3, 0), boxCount: 1 });
    expect(baked(walled, -4, 0, 0, 1).lamp).toBeCloseTo(baked(room({}), -4, 0, 0, 1).lamp, 6);
    expect(baked(room(LAMP), -4, 0, 0, 1).lamp, "control: with no wall the lamp reaches it").toBeGreaterThan(1.5 * baked(room({}), -4, 0, 0, 1).lamp);
  });
});
