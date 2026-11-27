import { afterEach, describe, expect, it } from "vitest";
import { firstMismatch } from "../kernel/compare-arrays.test-util.ts";
import { GQ, G } from "./ground-clock.ts";
import { Ground, setGround } from "./ground.ts";
import { mulberry32 } from "./placements.ts";
import { BAKE, C_TOUCH, HIT_SIZE, wheelContact } from "./surfaces.ts";

/**
 * A wheel's footprint (`wheelContact`) leaves a point unasked when the highest the static ground stands over the whole footprint puts it
 * under the best rise so far, less the arcs' margin; the arcs' pass asks it only when it neighbours a ring's highest point. Every answer
 * must be the one the all-points reading gives (`BAKE.on` false, as `--verify`'s live reference), bit for bit.
 */
const PLANES = 40;
const HUBS = 1000;
const SPAN = 6;

/** Rectangles of random height (0 to 0.5 m) over a floor, so edges and steps lie all over the square. */
function patchwork(random: () => number): Ground {
  const g = new Ground();
  g.addPlane(0, -50, 50, -50, 50, Infinity);
  for (let k = 0; k < PLANES; k++) {
    const x0 = (random() * 2 - 1) * SPAN;
    const z0 = (random() * 2 - 1) * SPAN;
    g.addPlane(random() * 0.5, x0, x0 + 0.3 + random() * 3, z0, z0 + 0.3 + random() * 3, Infinity);
  }
  return g;
}

/** The body's rotation (world x, y, z axes) turned `yaw` about up, then pitched `pitch` about its own x and rolled `roll` about its own z. */
function axesOf(yaw: number, pitch: number, roll: number, out: Float64Array): void {
  const [cy, sy, cp, sp, cr, sr] = [Math.cos(yaw), Math.sin(yaw), Math.cos(pitch), Math.sin(pitch), Math.cos(roll), Math.sin(roll)];
  // x axis, y axis, z axis of R = Ry · Rx · Rz.
  out.set([cy * cr + sy * sp * sr, cp * sr, -sy * cr + cy * sp * sr, -cy * sr + sy * sp * cr, cp * cr, sy * sr + cy * sp * cr, sy * cp, -sp, cy * cp]);
}

function readAll(seed: number, bake: boolean): { rows: number[][]; seeks: number } {
  const random = mulberry32(seed);
  setGround(patchwork(random));
  const hub = new Float64Array(3);
  const axes = new Float64Array(9);
  const out = new Float64Array(HIT_SIZE);
  const rows: number[][] = [];
  BAKE.on = bake;
  GQ.on = true;
  GQ.calls[G.seek] = 0;
  try {
    for (let k = 0; k < HUBS; k++) {
      hub.set([(random() * 2 - 1) * SPAN, 0.3 + random() * 0.5, (random() * 2 - 1) * SPAN]);
      axesOf(random() * 6.28, (random() - 0.5) * 0.4, (random() - 0.5) * 0.4, axes);
      wheelContact(hub, axes, 0.8 + random() * 0.6, 0.9 + random() * 0.3, -1, out);
      rows.push(Array.from(out.subarray(0, C_TOUCH + 1)));
    }
  } finally {
    BAKE.on = true;
    GQ.on = false;
  }
  return { rows, seeks: GQ.calls[G.seek]! };
}

describe("given wheels over a patchwork of steps and edges", () => {
  afterEach(() => setGround(null));

  // mutation: sed -i '/^        if (_pid\[kn\] !== _pid\[kn\]) askSkipped(hub, axes, skip, kn, out);/d' src/game/world/surfaces.ts
  it("when 1000 wheels are read with the footprint's skip and with every point asked, then every contact entry is the same bit for bit", () => {
    for (const seed of [1, 2, 3]) {
      const skipped = readAll(seed, true);
      const asked = readAll(seed, false);
      for (let k = 0; k < HUBS; k++) expect(firstMismatch(skipped.rows[k], asked.rows[k]), `seed ${seed} wheel ${k}`).toBeUndefined();
    }
  });

  // mutation: sed -i 's/    treadReach.tops !== null || (n === FOOT \&\& !BAKE.on)/    treadReach.tops !== null || n === FOOT/' src/game/world/surfaces.ts
  it("when the same wheels are read, then the skip asks the ground at least a fifth fewer times than asking every point", () => {
    const skipped = readAll(1, true);
    const asked = readAll(1, false);
    expect(skipped.seeks, `seeks ${skipped.seeks} against ${asked.seeks}`).toBeLessThan(0.8 * asked.seeks);
  });
});
