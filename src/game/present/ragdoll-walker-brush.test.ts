import { afterEach, describe, expect, it } from "vitest";
import * as THREE from "three";
import { FRAME_HZ } from "../kernel/constants.ts";
import { setGround } from "../world/ground.ts";
import { MAX_RISER, TREAD_RUN } from "../world/openworld/interior-kinds.ts";
import { driverLook } from "./driver-look.ts";
import type { RagdollSystem } from "./engine-ragdoll.ts";
import { WALKER_SLOT } from "./ragdoll-pool.ts";
import { flatSystem } from "./ragdoll-throws.test-util.ts";
import type { FloorBox } from "./walker-floor.ts";
import { RUN_SPEED, SPRINT_SPEED, WALK_SPEED } from "./walker-locomotion.ts";

const FRAME = 1 / FRAME_HZ;
/** He stands this long (s) before he is asked to move. */
const SETTLE_SECONDS = 1;
/** Brushing the world leaves him at least this share of his strength: a stagger takes it to 0.5 or less. */
const UNSHAKEN = 0.95;
/** A flight of a rowhome's stairs: risers and treads as its interior builds them, 0.9 m between its party wall and its banister. */
const FLIGHT_STEPS = 16;
const FLIGHT_HALF = 0.45;
const FLIGHT_FOOT_Z = 1;
/** He climbs for this long (s), and by then is past this many treads: the pace over steps is 0.5 m/s. */
const CLIMB_SECONDS = 8;
const CLIMB_TREADS = 12;
/** A blow across his way (N·s on his chest, twice the walker rows' car hit): a strike nobody modelled, which the hit rule alone fells him for. */
const SIDE_BLOW = 2400;
const DEG = Math.PI / 180;

let system: RagdollSystem | null = null;
afterEach(() => {
  system?.dispose();
  system = null;
  setGround(null);
});

/** The walker settled on flat ground at (`x`, 0, `z`) facing +z among the fixed `boxes`. */
async function standingAmong(boxes: FloorBox[], x: number): Promise<RagdollSystem> {
  const sys = await flatSystem();
  system = sys;
  sys.setFixedBoxes(boxes);
  sys.startWalker(new THREE.Vector3(x, 0, 0), 0, { cop: false, look: driverLook(0, 0) });
  for (let f = 0; f < SETTLE_SECONDS * FRAME_HZ; f++) sys.update(FRAME, [], true, true, null);
  return sys;
}

type Walk = { least: number; fell: boolean; z: number };

/** He walks toward `heading` at `command` m/s for `seconds`, the control held: his least strength, whether he went down, and where his torso ends along +z. */
function walk(sys: RagdollSystem, heading: number, command: number, seconds: number, each?: (frame: number) => void): Walk {
  const out: Walk = { least: 1, fell: false, z: 0 };
  for (let f = 0; f < Math.round(seconds * FRAME_HZ); f++) {
    sys.walker.heading = heading;
    sys.walker.command = command;
    sys.walker.ask();
    each?.(f);
    sys.update(FRAME, [], true, true, null);
    out.least = Math.min(out.least, sys.walker.strength);
    out.fell ||= sys.walker.state !== "stand";
  }
  out.z = sys["dolls"][WALKER_SLOT]!.bodies[0]!.translation().z;
  return out;
}

/** A wall along +z whose face stands at x = 0.5, from the ground to over his head. */
const WALL: FloorBox = { x0: 0.5, x1: 0.8, z0: -5, z1: 60, y0: 0, y1: 2.5 };

/** The flight along +z about x = 0 from `FLIGHT_FOOT_Z`, its landing after it, its party wall at +x and a banister at -x from before its foot (`newel`: from its first riser, its end a post there). */
function flight(newel = false): FloorBox[] {
  const boxes: FloorBox[] = [];
  const top = FLIGHT_FOOT_Z + TREAD_RUN * FLIGHT_STEPS;
  for (let s = 0; s < FLIGHT_STEPS; s++) {
    boxes.push({ x0: -FLIGHT_HALF, x1: FLIGHT_HALF, z0: FLIGHT_FOOT_Z + TREAD_RUN * s, z1: FLIGHT_FOOT_Z + TREAD_RUN * (s + 1), y0: 0, y1: MAX_RISER * (s + 1) });
  }
  boxes.push({ x0: -FLIGHT_HALF, x1: FLIGHT_HALF, z0: top, z1: top + 30, y0: 0, y1: MAX_RISER * FLIGHT_STEPS });
  boxes.push({ x0: FLIGHT_HALF, x1: FLIGHT_HALF + 0.3, z0: -2, z1: top + 30, y0: 0, y1: MAX_RISER * FLIGHT_STEPS + 3 });
  boxes.push({ x0: -FLIGHT_HALF - 0.06, x1: -FLIGHT_HALF, z0: newel ? FLIGHT_FOOT_Z : -2, z1: top + 30, y0: 0, y1: MAX_RISER * FLIGHT_STEPS + 1 });
  return boxes;
}

describe("given the walker beside a wall on flat ground", () => {
  // mutation: sed -i 's/^    return Math.min(ahead, stopped);/    return ahead;/' src/game/present/ragdoll-walker.ts
  for (const speed of [RUN_SPEED, SPRINT_SPEED]) {
    it(`when he runs at ${speed} m/s into it at 30 degrees and slides along it, then he keeps his feet and his strength`, async () => {
      const sys = await standingAmong([WALL], 0);
      const run = walk(sys, 30 * DEG, speed, 4);
      expect(run.fell, "he stayed on his feet").toBe(false);
      expect(run.least, `least strength ${run.least.toFixed(2)}`).toBeGreaterThanOrEqual(UNSHAKEN);
    });
  }

  // mutation: sed -i 's/^    return Math.min(ahead, stopped);/    return 0;/' src/game/present/ragdoll-walker.ts
  it("when a blow across his way lands on his chest as he walks along it, then he is knocked down", async () => {
    const sys = await standingAmong([WALL], 0.1);
    const torso = sys["dolls"][WALKER_SLOT]!.bodies[0]!;
    const blow = new THREE.Vector3(-SIDE_BLOW, 0, 0);
    const run = walk(sys, 5 * DEG, WALK_SPEED, 2, (f) => {
      if (f === FRAME_HZ) torso.applyImpulse(blow, true);
    });
    expect(run.fell, "he went down").toBe(true);
  });
});

/** Where he starts across the flight (m), the way he heads, his pace: each presses a shoulder into the party wall (+x) or the banister (-x). */
const flightCases: readonly { it: string; x: number; heading: number; command: number }[] = [
  { it: "when he runs up it 10 degrees into the party wall, then he keeps his feet and his strength", x: 0, heading: 10 * DEG, command: RUN_SPEED },
  { it: "when he runs up it along the party wall, 5 degrees into it, then he keeps his feet and his strength", x: 0.2, heading: 5 * DEG, command: RUN_SPEED },
  // mutation (the sinking torso): sed -i 's/^    const dy = Math.max(0, doll.vel\[1\]! - held\[1\]! + HOLD_RATE \* ly \* keep);/    const dy = doll.vel[1]! - held[1]! + HOLD_RATE * ly * keep;/' src/game/present/ragdoll-walker.ts
  { it: "when he runs up it 5 degrees into the banister, then he keeps his feet and his strength", x: 0.2, heading: -5 * DEG, command: RUN_SPEED },
  { it: "when he walks up it across to the party wall at 10 degrees, then he keeps his feet and his strength", x: -0.2, heading: 10 * DEG, command: WALK_SPEED },
  // mutation (a sprint ramps as a run on the treads): sed -i 's/^      const top = share < 1 ? Math.min(command, RUN_SPEED) : command;/      const top = command;/' src/game/present/walker-floor.ts
  { it: "when he sprints straight up it beside the party wall, then he keeps his feet and his strength", x: 0.2, heading: 0, command: SPRINT_SPEED },
  // mutation (a foot across the banister reads the floor beyond it): sed -i 's/^    const height = this.floor.walled(this.anchorPos\[0\]!, this.anchorPos\[2\]!, x, z) ? NO_FLOOR : this.floor.under(x, z);/    const height = this.floor.under(x, z);/' src/game/present/ragdoll-walker.ts
  // mutation (a foot planted across the banister sets his floor): sed -i 's/^      if (planted\[f\] !== 1 || this.walled(fromX, fromZ, plant\[f \* 3\]!, plant\[f \* 3 + 2\]!)) continue;/      if (planted[f] !== 1) continue;/' src/game/present/walker-floor.ts
  { it: "when he runs up it 10 degrees into the banister, then he keeps his feet and his strength", x: 0, heading: -10 * DEG, command: RUN_SPEED },
];

// mutation (the runs): sed -i 's/^      return Math.min(command, STEP_PACE + (top - STEP_PACE) \* share, braking);/      return Math.min(command, STEP_PACE + (top - STEP_PACE) * share);/' src/game/present/walker-floor.ts
// mutation (into the banister): sed -i 's/^      if (box.y1 > ask + WALL_RISE) return NO_FLOOR;/      if (box.y1 > ask + WALL_RISE) continue;/' src/game/present/walker-floor.ts
describe("given the walker at the foot of a rowhome's stair flight between its party wall and a banister", () => {
  for (const testCase of flightCases) {
    it(testCase.it, async () => {
      const sys = await standingAmong(flight(), testCase.x);
      const start = sys["dolls"][WALKER_SLOT]!.bodies[0]!.translation().z;
      const climb = walk(sys, testCase.heading, testCase.command, CLIMB_SECONDS);
      expect(climb.fell, "he stayed on his feet").toBe(false);
      expect(climb.least, `least strength ${climb.least.toFixed(2)}`).toBeGreaterThanOrEqual(UNSHAKEN);
      expect(climb.z - start, `he went up the flight: ${(climb.z - start).toFixed(2)} m`).toBeGreaterThan(FLIGHT_FOOT_Z + TREAD_RUN * CLIMB_TREADS);
    });
  }

  // mutation: sed -i 's/^    const height = this.floor.walled(this.anchorPos\[0\]!, this.anchorPos\[2\]!, x, z) ? NO_FLOOR : this.floor.under(x, z);/    const height = this.floor.under(x, z);/' src/game/present/ragdoll-walker.ts
  it("when he walks up it 10 degrees into the banister, its end a post at the first riser, then he keeps his feet and his strength", async () => {
    const sys = await standingAmong(flight(true), -0.2);
    const climb = walk(sys, -10 * DEG, WALK_SPEED, CLIMB_SECONDS);
    expect(climb.fell, "he stayed on his feet").toBe(false);
    expect(climb.least, `least strength ${climb.least.toFixed(2)}`).toBeGreaterThanOrEqual(UNSHAKEN);
  });
});
