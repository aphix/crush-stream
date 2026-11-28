import { afterEach, describe, expect, it } from "vitest";
import { firstMismatch } from "../kernel/compare-arrays.test-util.ts";
import { GQ, G } from "./ground-clock.ts";
import { Ground, setGround } from "./ground.ts";
import { mulberry32 } from "./placements.ts";
import { armSolids, BAKE, C_TOUCH, HIT_SIZE, Surface, wheelContact } from "./surfaces.ts";

/**
 * A wheel's footprint (`wheelContact`) leaves a point unasked when the highest the static ground stands over the whole footprint puts it
 * under the best rise so far, less the arcs' margin; the arcs' pass asks it only when it neighbours a ring's highest point. Every answer
 * must be the one the all-points reading gives (`BAKE.on` false, as `--verify`'s live reference), bit for bit.
 */
const PLANES = 40;
const HUBS = 1000;
const SPAN = 6;
const PROPS = 30;
/** The square the props stand in and the wheels are read over (half side, m): several index cells, some of them empty. */
const YARD = 20;

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

/** One floor, so the only ground query that lists its candidates (`findAll`) is the solids'. */
function flat(): Ground {
  const g = new Ground();
  g.addPlane(0, -50, 50, -50, 50, Infinity);
  return g;
}

/** Boxes 0.4 to 1 m on a side and up to 0.5 m high scattered over the square, as solid props are: more than the index takes whole, so it lists them by cell. */
function props(random: () => number): Surface {
  const solids = new Surface();
  for (let k = 0; k < PROPS; k++) solids.addPrism({ x: (random() * 2 - 1) * YARD, z: (random() * 2 - 1) * YARD, yaw: random() * 6.28, hx: 0.2 + random() * 0.3, hz: 0.2 + random() * 0.3, base: 0, top: 0.1 + random() * 0.4, id: k, moves: false });
  return solids;
}

/** The body's rotation (world x, y, z axes) turned `yaw` about up, then pitched `pitch` about its own x and rolled `roll` about its own z. */
function axesOf(yaw: number, pitch: number, roll: number, out: Float64Array): void {
  const [cy, sy, cp, sp, cr, sr] = [Math.cos(yaw), Math.sin(yaw), Math.cos(pitch), Math.sin(pitch), Math.cos(roll), Math.sin(roll)];
  // x axis, y axis, z axis of R = Ry · Rx · Rz.
  out.set([cy * cr + sy * sp * sr, cp * sr, -sy * cr + cy * sp * sr, -cy * sr + sy * sp * cr, cp * cr, sy * sr + cy * sp * cr, sy * cp, -sp, cy * cp]);
}

function readAll(seed: number, bake: boolean, solids = false): { rows: number[][]; seeks: number; solidFinds: number } {
  const random = mulberry32(seed);
  setGround(solids ? flat() : patchwork(random));
  if (solids) armSolids(props(random));
  const span = solids ? YARD : SPAN;
  const hub = new Float64Array(3);
  const axes = new Float64Array(9);
  const out = new Float64Array(HIT_SIZE);
  const rows: number[][] = [];
  BAKE.on = bake;
  GQ.on = true;
  GQ.calls[G.seek] = 0;
  GQ.calls[G.findAll] = 0;
  try {
    for (let k = 0; k < HUBS; k++) {
      hub.set([(random() * 2 - 1) * span, 0.3 + random() * 0.5, (random() * 2 - 1) * span]);
      axesOf(random() * 6.28, (random() - 0.5) * 0.4, (random() - 0.5) * 0.4, axes);
      wheelContact(hub, axes, 0.8 + random() * 0.6, 0.9 + random() * 0.3, -1, out);
      rows.push(Array.from(out.subarray(0, C_TOUCH + 1)));
    }
  } finally {
    BAKE.on = true;
    GQ.on = false;
  }
  return { rows, seeks: GQ.calls[G.seek]!, solidFinds: GQ.calls[G.findAll]! };
}

describe("given wheels over a patchwork of steps and edges", () => {
  afterEach(() => {
    armSolids(null);
    setGround(null);
  });

  it("when 1000 wheels are read with the footprint's skip and with every point asked, then every contact entry is the same bit for bit", () => {
    for (const seed of [1, 2, 3]) {
      const skipped = readAll(seed, true);
      const asked = readAll(seed, false);
      for (let k = 0; k < HUBS; k++) expect(firstMismatch(skipped.rows[k], asked.rows[k]), `seed ${seed} wheel ${k}`).toBeUndefined();
    }
  });

  it("when the same wheels are read, then the skip asks the ground at least a fifth fewer times than asking every point", () => {
    const skipped = readAll(1, true);
    const asked = readAll(1, false);
    expect(skipped.seeks, `seeks ${skipped.seeks} against ${asked.seeks}`).toBeLessThan(0.8 * asked.seeks);
  });

  it("when the same wheels are read among 30 solid props, then every contact entry is the same bit for bit with the solids left unasked where they list nothing", () => {
    for (const seed of [1, 2, 3]) {
      const skipped = readAll(seed, true, true);
      const asked = readAll(seed, false, true);
      for (let k = 0; k < HUBS; k++) expect(firstMismatch(skipped.rows[k], asked.rows[k]), `seed ${seed} wheel ${k}`).toBeUndefined();
    }
  });

  it("when wheels are read among 30 solid props, then the solids are asked of at least a fifth fewer points than asking every point", () => {
    const skipped = readAll(1, true, true);
    const asked = readAll(1, false, true);
    expect(skipped.solidFinds, `solid finds ${skipped.solidFinds} against ${asked.solidFinds}`).toBeLessThan(0.8 * asked.solidFinds);
  });

  it("when a hub stands in an empty index cell with a prop in the next cell 0.3 m from its hub along its roll, then the solids are asked and the prop is read as the all-points reading reads it", () => {
    const solids = new Surface();
    solids.addPrism({ x: 0, z: 8.6, yaw: 0, hx: 1, hz: 0.3, base: 0, top: 0.4, id: 0, moves: false });
    // Nine more, far off, so the index lists by cell (`INDEX_FROM`).
    for (let k = 1; k <= 9; k++) solids.addPrism({ x: -40 - 4 * k, z: 30, yaw: 0, hx: 0.3, hz: 0.3, base: 0, top: 0.4, id: k, moves: false });
    setGround(flat());
    armSolids(solids);
    const hub = Float64Array.of(0, 0.45, 7.99);
    const axes = Float64Array.of(1, 0, 0, 0, 1, 0, 0, 0, 1);
    const [asked, skipped] = [false, true].map((bake) => {
      const out = new Float64Array(HIT_SIZE);
      BAKE.on = bake;
      try {
        wheelContact(hub, axes, 1, 1, -1, out);
      } finally {
        BAKE.on = true;
      }
      return Array.from(out.subarray(0, C_TOUCH + 1));
    });
    expect(asked[0]!, "control: the prop's top is under the tread").toBeGreaterThan(-0.1);
    expect(firstMismatch(skipped, asked)).toBeUndefined();
  });

  it("when a wheel stands on ground whose slope turns by 0.04 m/m along each axis (a tread's tenth to a millimetre of arc over its ring bottom), then only its five ring bottoms and its hub ask the ground", () => {
    const g = new Ground();
    const N = 40;
    // A checkerboard of 0.02 m over 1 m nodes: slopes of +-0.02 side by side, a spread of 0.04 either way.
    const heights = Float32Array.from({ length: N * N }, (_, k) => 0.02 * ((Math.floor(k / N) + (k % N)) % 2));
    g.addGrid({ nu: N, nv: N, step: 1, stepV: 1, u0: 0, v0: 0, heights, ox: -N / 2, oy: 0, oz: -N / 2, reach: Infinity, unbounded: true });
    setGround(g);
    GQ.on = true;
    GQ.calls[G.seek] = 0;
    try {
      wheelContact(Float64Array.of(0.3, 0.45, 0.3), Float64Array.of(1, 0, 0, 0, 1, 0, 0, 0, 1), 1, 1, -1, new Float64Array(HIT_SIZE));
    } finally {
      GQ.on = false;
    }
    expect(GQ.calls[G.seek], "seeks of one wheel").toBeLessThanOrEqual(6);
  });
});
