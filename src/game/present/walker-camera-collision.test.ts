import { describe, expect, it } from "vitest";
import { FRAME_HZ } from "../kernel/constants.ts";
import { acrossAt, boomAt, CAMERA_RADIUS, FOLLOW_BOOM, PIVOT_OVER_TORSO, REST_PITCH, SHOULDER_BOOM, type Sweep, WalkerView } from "./walker-camera.ts";

const FRAME = 1 / FRAME_HZ;
/** The torso's centre standing (m). */
const STANDING_TORSO = 1.13;
/** How far into a box (m) the eye may stand before it counts as inside: the ball's skin. */
const INSIDE_SLACK = 0.03;
/** Turns tried round him (rad, a twenty-fourth of a circle each). */
const TURN_STEP = Math.PI / 12;

type Box = { x0: number; y0: number; z0: number; x1: number; y1: number; z1: number };

/** A ball of `CAMERA_RADIUS` swept against `boxes` (each grown by the radius: its corners square, so never later than the true touch). */
function boxSweep(boxes: readonly Box[]): Sweep {
  return (x, y, z, dx, dy, dz, length) => {
    let reach = length;
    for (const b of boxes) {
      let t0 = 0;
      let t1 = length;
      const axes = [
        [x, dx, b.x0, b.x1],
        [y, dy, b.y0, b.y1],
        [z, dz, b.z0, b.z1],
      ] as const;
      for (const [p, d, lo, hi] of axes) {
        const a = lo - CAMERA_RADIUS;
        const c = hi + CAMERA_RADIUS;
        if (Math.abs(d) < 1e-12) {
          if (p < a || p > c) t1 = -1;
          continue;
        }
        const ta = (a - p) / d;
        const tc = (c - p) / d;
        t0 = Math.max(t0, Math.min(ta, tc));
        t1 = Math.min(t1, Math.max(ta, tc));
      }
      if (t0 <= t1) reach = Math.min(reach, t0);
    }
    return reach;
  };
}

/** How deep (m) the point stands inside the deepest box: 0 outside all of them. */
function depthInside(boxes: readonly Box[], x: number, y: number, z: number): number {
  let deepest = 0;
  for (const b of boxes) deepest = Math.max(deepest, Math.min(x - b.x0, b.x1 - x, y - b.y0, b.y1 - y, z - b.z0, b.z1 - z));
  return deepest;
}

const WALL_TOP = 3;
const scenes: readonly { it: string; boxes: readonly Box[] }[] = [
  {
    it: "when he stands in a corridor 2 m wide and the view is turned all the way round him, then the eye never stands inside a wall",
    boxes: [
      { x0: -1.5, y0: 0, z0: -20, x1: -1, y1: WALL_TOP, z1: 20 },
      { x0: 1, y0: 0, z0: -20, x1: 1.5, y1: WALL_TOP, z1: 20 },
    ],
  },
  {
    it: "when he stands just inside a doorway 1 m wide and the view is turned all the way round him, then the eye never stands inside the wall or its jambs",
    boxes: [
      { x0: -6, y0: 0, z0: -0.9, x1: -0.5, y1: WALL_TOP, z1: -0.6 },
      { x0: 0.5, y0: 0, z0: -0.9, x1: 6, y1: WALL_TOP, z1: -0.6 },
      { x0: -0.5, y0: 2.1, z0: -0.9, x1: 0.5, y1: WALL_TOP, z1: -0.6 },
    ],
  },
  {
    it: "when he stands beside a parked car and a building's corner and the view is turned all the way round him, then the eye never stands inside either",
    boxes: [
      { x0: 0.6, y0: 0, z0: -2.3, x1: 2.4, y1: 1.45, z1: 2.3 },
      { x0: -10, y0: 0, z0: -10, x1: -0.8, y1: 12, z1: -1.2 },
    ],
  },
];

describe("given the camera behind him among solids", () => {
  // mutation: sed -i 's/    this.boom = letGo(this.boom, stopShort(sweep(ox, py, oz, bx, sp, bz, length), length), dt);/    this.boom = length;/' src/game/present/walker-camera.ts
  for (const scene of scenes) {
    it(scene.it, () => {
      const sweep = boxSweep(scene.boxes);
      for (const level of [FOLLOW_BOOM, SHOULDER_BOOM]) {
        const view = new WalkerView();
        for (let k = 0; k < 24; k++) {
          for (const pitch of [-0.4, REST_PITCH, 1]) {
            view.shoulder(0, STANDING_TORSO, 0, 0, STANDING_TORSO + PIVOT_OVER_TORSO, 0, k * TURN_STEP, pitch, boomAt(level, pitch), acrossAt(level), sweep, FRAME);
            const depth = depthInside(scene.boxes, view.eye[0]!, view.eye[1]!, view.eye[2]!);
            expect(depth, `zoom ${level} m, turn ${k}, pitch ${pitch}: the eye (${view.eye[0]!.toFixed(2)}, ${view.eye[1]!.toFixed(2)}, ${view.eye[2]!.toFixed(2)}) is ${depth.toFixed(2)} m in a solid`).toBeLessThanOrEqual(0);
          }
        }
      }
    });
  }
});

/** A wall `gap` m behind him (the eye's way at yaw 0 is +z): the boom stops short of it. */
function wallBehind(gap: number): Box[] {
  return [{ x0: -5, y0: 0, z0: gap, x1: 5, y1: WALL_TOP, z1: gap + 0.3 }];
}

/** The eye's distance back from the pivot after one frame at a time against the walls each frame gives. */
function boomOver(frames: readonly Box[][]): number[] {
  const view = new WalkerView();
  const out: number[] = [];
  for (const boxes of frames) {
    view.shoulder(0, STANDING_TORSO, 0, 0, STANDING_TORSO + PIVOT_OVER_TORSO, 0, 0, 0, FOLLOW_BOOM, 0, boxSweep(boxes), FRAME);
    out.push(view.eye[2]!);
  }
  return out;
}

describe("given the camera behind him on a level boom with nothing round him", () => {
  // mutation: sed -i 's/^const LET_GO_TIME = 0.24;/const LET_GO_TIME = 1e-6;/' src/game/present/walker-camera.ts
  it("when a wall comes in 1.5 m behind him, then the eye is in short of it the same frame; when it goes, the eye eases back out over about a quarter second", () => {
    const near = 1.5;
    const open = Array.from({ length: 10 }, () => [] as Box[]);
    const walled = Array.from({ length: 10 }, () => wallBehind(near));
    const inward = boomOver([...open, ...walled]);
    expect(inward[9], "the open boom (m)").toBeCloseTo(FOLLOW_BOOM, 6);
    expect(inward[10]! + CAMERA_RADIUS, "the first frame with the wall: the eye's ball short of its face (m)").toBeLessThanOrEqual(near + INSIDE_SLACK);
    const outward = boomOver([...walled, ...open, ...open, ...open, ...open, ...open, ...open]);
    const shut = outward[9]!;
    const share = (frame: number) => (outward[frame]! - shut) / (FOLLOW_BOOM - shut);
    expect(share(10), "the first frame without the wall: only a little of the way back out").toBeLessThan(0.2);
    expect(share(9 + Math.round(0.24 * FRAME_HZ)), "after one time constant (0.24 s): about two thirds of the way").toBeGreaterThan(0.5);
    expect(share(9 + Math.round(0.24 * FRAME_HZ)), "after one time constant (0.24 s): not all of it").toBeLessThan(0.8);
    expect(share(9 + FRAME_HZ), "after a second: back out").toBeGreaterThan(0.98);
  });
});
