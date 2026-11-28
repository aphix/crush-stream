import { describe, expect, it } from "vitest";
import { hypot2 } from "../../kernel/physics-core.js";
import { mulberry32 } from "../../world/placements.ts";
import { DOOR_FACE, type DoorLeaf } from "../../world/openworld/interior-plan.ts";
import { DOOR_RANGE, DOOR_REACH, DOOR_SWING_SECONDS } from "./interior-constants.ts";
import { DoorSet, type DoorOpeners } from "./interior-doors.ts";

const LEAVES = 400;
const SPAN = 220;
const PEOPLE = 90;

/** A leaf standing at (x, z), its hinge and swing as a plain door's. */
const leafAt = (x: number, z: number): DoorLeaf => ({ hingeX: x, hingeZ: z, floorY: 0, closedX: 1, closedZ: 0, openX: 0, openZ: 1, width: 1, height: 2, x, z, face: DOOR_FACE.street, boxX: x, boxZ: z, vestibule: null });

describe("given doors over a city, and people, figures and a walker standing about it", () => {
  it("when the doors swing for a whole swing's time, then exactly the doors in range with someone within reach of them stand open", () => {
    const random = mulberry32(5);
    const leaves = Array.from({ length: LEAVES }, () => leafAt((random() - 0.5) * SPAN, (random() - 0.5) * SPAN));
    // A third of the people and figures stand at a door, within a hair of its reach, the rest anywhere.
    const spot = (): [number, number] => {
      if (random() < 0.33) {
        const leaf = leaves[Math.floor(random() * LEAVES)]!;
        const angle = random() * 2 * Math.PI;
        const away = DOOR_REACH * (0.9 + 0.2 * random());
        return [leaf.x + away * Math.cos(angle), leaf.z + away * Math.sin(angle)];
      }
      return [(random() - 0.5) * SPAN, (random() - 0.5) * SPAN];
    };
    const people = Array.from({ length: PEOPLE }, spot);
    const figures = Array.from({ length: 6 }, spot);
    const [walkerX, walkerZ] = spot();
    const set = (points: [number, number][]) => ({ count: points.length, x: Float64Array.from(points, (p) => p[0]), z: Float64Array.from(points, (p) => p[1]), shown: new Uint8Array(points.length).fill(1), look: new Uint32Array(points.length) });
    const openers: DoorOpeners = { poses: set(people), walker: { x: walkerX, z: walkerZ }, others: [set(figures)], closed: null };
    const doors = new DoorSet(leaves);
    doors.update(0, 0, DOOR_SWING_SECONDS * 2, openers);
    const everyone = [...people, ...figures, [walkerX, walkerZ]];
    let open = 0;
    for (let door = 0; door < LEAVES; door++) {
      const leaf = leaves[door]!;
      const expected = hypot2(leaf.x, leaf.z) <= DOOR_RANGE && everyone.some(([x, z]) => hypot2(x! - leaf.x, z! - leaf.z) <= DOOR_REACH);
      expect(doors.isOpen(door), `door ${door}`).toBe(expected);
      if (expected) open++;
    }
    expect(open, "doors open").toBeGreaterThan(10);
  });
});
