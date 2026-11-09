import { afterEach, describe, expect, it } from "vitest";
import * as THREE from "three";
import { FRAME_HZ } from "../kernel/constants.ts";
import { Ground, setGround } from "../world/ground.ts";
import { driverLook } from "./driver-look.ts";
import type { RagdollSystem } from "./engine-ragdoll.ts";
import { WALKER_SLOT } from "./ragdoll-pool.ts";
import { flatSystem } from "./ragdoll-throws.test-util.ts";
import type { FloorBox } from "./walker-floor.ts";
import { RUN_SPEED, WALK_SPEED } from "./walker-locomotion.ts";

const FRAME = 1 / FRAME_HZ;
/** Seconds he stands still before a row measures his standing height. */
const SETTLE_SECONDS = 1;
/** A standing torso's centre is at least this high (m) over the floor, and never over the second figure. */
const STANDING_MIN = 0.95;
const STANDING_MAX = 1.25;
/** One tread of the stoop's stairs (m): the facade stoop's own riser and tread. */
const RISER = 0.18;
const TREAD = 0.28;
const STOOP_STEPS = 5;
/** Where each row's obstacle begins along +z (m), the stairs' foot. */
const FIRST_Z = 1;

type PrismBox = { x0: number; x1: number; z0: number; z1: number; top: number; slope?: number };

let system: RagdollSystem | null = null;

afterEach(() => {
  system?.dispose();
  system = null;
  setGround(null);
});

/** Flat ground at 0 with each box a prism from the ground up to `top` (`slope`: the rise per metre along +z over the middle). */
function groundWith(boxes: readonly PrismBox[]): Ground {
  const ground = new Ground();
  ground.addPlane(0, -1e4, 1e4, -1e4, 1e4, Infinity);
  for (let id = 0; id < boxes.length; id++) {
    const b = boxes[id]!;
    ground.addPrism({ x: (b.x0 + b.x1) / 2, z: (b.z0 + b.z1) / 2, yaw: 0, hx: (b.x1 - b.x0) / 2, hz: (b.z1 - b.z0) / 2, base: 0, top: b.top, gw: b.slope ?? 0, id });
  }
  return ground;
}

/** The walker standing at (`x`, 0) facing +z on `ground`, settled. */
async function standingOn(ground: Ground, x = 0): Promise<RagdollSystem> {
  const sys = await flatSystem();
  system = sys;
  setGround(ground);
  expect(sys.startWalker(new THREE.Vector3(x, 0, 0), 0, { cop: false, look: driverLook(0, 0) }), "the walker is placed").toBe(WALKER_SLOT);
  frames(sys, SETTLE_SECONDS);
  return sys;
}

function torso(sys: RagdollSystem): THREE.Vector3 {
  const p = sys["dolls"][WALKER_SLOT]!.bodies[0]!.translation();
  return new THREE.Vector3(p.x, p.y, p.z);
}

function frames(sys: RagdollSystem, seconds: number, each?: () => void): void {
  for (let f = 0; f < Math.round(seconds * FRAME_HZ); f++) {
    each?.();
    sys.update(FRAME, [], true, true, null);
  }
}

type Walk = { fell: boolean; peakY: number; farthestZ: number };

/** He walks along +z at `command` m/s for `seconds`, the player's control held. */
function walkAlong(sys: RagdollSystem, command: number, seconds: number): Walk {
  const out: Walk = { fell: false, peakY: -Infinity, farthestZ: -Infinity };
  sys.walker.heading = 0;
  sys.walker.command = command;
  frames(sys, seconds, () => {
    sys.walker.ask();
    const at = torso(sys);
    out.peakY = Math.max(out.peakY, at.y);
    out.farthestZ = Math.max(out.farthestZ, at.z);
    out.fell ||= sys.walker.state !== "stand";
  });
  return out;
}

/** The stoop of the facade lane: five treads each a riser higher than the last, then a landing at the door's sill. */
function stoop(): PrismBox[] {
  const boxes: PrismBox[] = [];
  for (let step = 1; step <= STOOP_STEPS; step++) boxes.push({ x0: -0.8, x1: 0.8, z0: FIRST_Z + TREAD * (step - 1), z1: FIRST_Z + TREAD * step, top: RISER * step });
  return boxes;
}

const LANDING_Z0 = FIRST_Z + TREAD * STOOP_STEPS;
const LANDING_TOP = RISER * STOOP_STEPS;
/** The door's wall stands this far past the landing (m), its opening 1 m wide. */
const WALL_Z0 = LANDING_Z0 + 0.5;
const WALL_THICK = 0.3;
const DOOR_HALF = 0.5;
const WALL_TOP = 9;
/** A floor or plateau that runs on past anywhere a row walks to (m). */
const RUNS_ON_Z = 40;

describe("given the walker at the foot of a stoop whose door is in a wall (step prisms in the ground)", () => {
  it("when he walks at it, then he climbs the five steps and goes in through the door, standing on the floor inside", async () => {
    const sys = await standingOn(
      groundWith([
        ...stoop(),
        { x0: -4, x1: 4, z0: LANDING_Z0, z1: RUNS_ON_Z, top: LANDING_TOP },
        { x0: -4, x1: -DOOR_HALF, z0: WALL_Z0, z1: WALL_Z0 + WALL_THICK, top: WALL_TOP },
        { x0: DOOR_HALF, x1: 4, z0: WALL_Z0, z1: WALL_Z0 + WALL_THICK, top: WALL_TOP },
      ]),
    );
    const start = torso(sys);
    const walk = walkAlong(sys, WALK_SPEED, 12);
    const end = torso(sys);
    expect(walk.fell, "he stayed on his feet").toBe(false);
    expect(end.z, `through the door: z ${end.z.toFixed(2)}`).toBeGreaterThan(WALL_Z0 + WALL_THICK + 0.3);
    expect(end.y - LANDING_TOP, `standing on the floor inside: ${(end.y - LANDING_TOP).toFixed(2)} m over it`).toBeGreaterThan(STANDING_MIN);
    expect(end.y - start.y, `${(end.y - start.y).toFixed(2)} m higher than at the foot`).toBeGreaterThan(LANDING_TOP - 0.1);
  });
});

describe("given the walker and a curb", () => {
  it("when he crosses a sidewalk slab, then he rises onto it and comes back down on the far side without falling", async () => {
    const curb = 0.15;
    const sys = await standingOn(groundWith([{ x0: -4, x1: 4, z0: 1.5, z1: 4.5, top: curb }]));
    const start = torso(sys);
    const walk = walkAlong(sys, WALK_SPEED, 9);
    const end = torso(sys);
    expect(walk.fell, "he stayed on his feet").toBe(false);
    expect(walk.farthestZ, `past the far curb: z ${walk.farthestZ.toFixed(2)}`).toBeGreaterThan(5.5);
    expect(walk.peakY - start.y, `up on the slab: ${(walk.peakY - start.y).toFixed(3)} m`).toBeGreaterThan(curb - 0.04);
    expect(Math.abs(end.y - start.y), `down again: ${(end.y - start.y).toFixed(3)} m off his first height`).toBeLessThan(0.06);
  });
});

describe("given the walker and a ramp", () => {
  it("when he walks up it, then he is on its top at its height, upright", async () => {
    const length = 5;
    const rise = 0.6;
    const ramp: PrismBox = { x0: -2, x1: 2, z0: 1, z1: 1 + length, top: rise / 2, slope: rise / length };
    const plateau: PrismBox = { x0: -2, x1: 2, z0: 1 + length, z1: RUNS_ON_Z, top: rise };
    const sys = await standingOn(groundWith([ramp, plateau]));
    const start = torso(sys);
    const walk = walkAlong(sys, WALK_SPEED, 10);
    const end = torso(sys);
    expect(walk.fell, "he stayed on his feet").toBe(false);
    expect(end.z, `on the plateau: z ${end.z.toFixed(2)}`).toBeGreaterThan(1 + length + 0.3);
    expect(end.y - start.y, `${(end.y - start.y).toFixed(2)} m higher`).toBeGreaterThan(rise - 0.08);
    expect(end.y - rise, `standing height over the plateau ${(end.y - rise).toFixed(2)}`).toBeLessThan(STANDING_MAX);
  });
});

describe("given the walker at the foot of a stoop made of one ramp prism and a landing box", () => {
  it("when he walks at it, then he climbs the ramp, which holds the stairs' 0.64 slope, and stands on the landing", async () => {
    const run = TREAD * STOOP_STEPS;
    const ramp: PrismBox = { x0: -0.8, x1: 0.8, z0: FIRST_Z, z1: FIRST_Z + run, top: LANDING_TOP / 2, slope: LANDING_TOP / run };
    const sys = await standingOn(groundWith([ramp, { x0: -4, x1: 4, z0: FIRST_Z + run, z1: RUNS_ON_Z, top: LANDING_TOP }]));
    const walk = walkAlong(sys, WALK_SPEED, 12);
    const end = torso(sys);
    expect(walk.fell, "he stayed on his feet").toBe(false);
    expect(end.z, `on the landing: z ${end.z.toFixed(2)}`).toBeGreaterThan(FIRST_Z + run + 0.3);
    expect(end.y - LANDING_TOP, `standing over the landing: ${(end.y - LANDING_TOP).toFixed(2)} m`).toBeGreaterThan(STANDING_MIN);
  });
});

describe("given the walker and a doorway with a raised threshold", () => {
  it("when he walks through the one-metre opening, then he is past the wall, standing", async () => {
    const z0 = 2;
    const sys = await standingOn(
      groundWith([
        { x0: -4, x1: -DOOR_HALF, z0, z1: z0 + WALL_THICK, top: WALL_TOP },
        { x0: DOOR_HALF, x1: 4, z0, z1: z0 + WALL_THICK, top: WALL_TOP },
        { x0: -DOOR_HALF, x1: DOOR_HALF, z0, z1: z0 + WALL_THICK, top: 0.12 },
      ]),
      0.1,
    );
    const walk = walkAlong(sys, WALK_SPEED, 6);
    expect(walk.fell, "he stayed on his feet").toBe(false);
    expect(walk.farthestZ, `through: z ${walk.farthestZ.toFixed(2)}`).toBeGreaterThan(z0 + WALL_THICK + 0.5);
  });
});

describe("given the walker and a bay window (a tall block that projects from a facade)", () => {
  it("when he runs at it, then it stops him in front of it, on his feet and on the ground", async () => {
    const face = 2;
    const sys = await standingOn(groundWith([{ x0: -1.2, x1: 1.2, z0: face, z1: face + 1.5, top: WALL_TOP }]));
    const start = torso(sys);
    const walk = walkAlong(sys, RUN_SPEED, 6);
    expect(walk.fell, "he stayed on his feet").toBe(false);
    expect(walk.farthestZ, `in front of the face: z ${walk.farthestZ.toFixed(2)}`).toBeLessThan(face);
    expect(walk.peakY - start.y, `no vault: ${(walk.peakY - start.y).toFixed(2)} m up`).toBeLessThan(0.15);
  });
});

describe("given a building's interior floor boxes that are in the world but not in the ground", () => {
  it("when he walks up its stairs of stacked boxes, then he stands on the landing at its height", async () => {
    const sys = await standingOn(groundWith([]));
    const boxes: FloorBox[] = [];
    for (let step = 1; step <= 4; step++) boxes.push({ x0: -0.8, x1: 0.8, z0: FIRST_Z + 0.26 * (step - 1), z1: FIRST_Z + 0.26 * step, y0: 0, y1: 0.19 * step });
    boxes.push({ x0: -3, x1: 3, z0: FIRST_Z + 0.26 * 4, z1: RUNS_ON_Z, y0: 0, y1: 0.19 * 4 });
    sys.setFixedBoxes(boxes);
    const walk = walkAlong(sys, WALK_SPEED, 9);
    const end = torso(sys);
    const top = 0.19 * 4;
    expect(walk.fell, "he stayed on his feet").toBe(false);
    expect(end.z, `on the landing: z ${end.z.toFixed(2)}`).toBeGreaterThan(FIRST_Z + 0.26 * 4 + 0.3);
    expect(end.y - top, `standing over the landing: ${(end.y - top).toFixed(2)} m`).toBeGreaterThan(STANDING_MIN);
    expect(end.y - top, `not lifted past standing: ${(end.y - top).toFixed(2)} m`).toBeLessThan(STANDING_MAX);
  });
});
