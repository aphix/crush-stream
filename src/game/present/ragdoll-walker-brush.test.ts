import { afterEach, describe, expect, it } from "vitest";
import * as THREE from "three";
import { FRAME_HZ } from "../kernel/constants.ts";
import { setGround } from "../world/ground.ts";
import { MAX_RISER, TREAD_RUN } from "../world/openworld/interior-kinds.ts";
import { driverLook } from "./driver-look.ts";
import type { RagdollSystem } from "./engine-ragdoll.ts";
import { PARTS } from "./ragdoll-body.ts";
import { WALKER_SLOT } from "./ragdoll-pool.ts";
import { flatSystem } from "./ragdoll-throws.test-util.ts";
import { Walker } from "./ragdoll-walker.ts";
import { type FloorBox, WalkFloor } from "./walker-floor.ts";
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
/** Past the newel post he climbs this far (m) in `CLIMB_SECONDS`: held at the post's end he gets 2.5 m, over it about 4.3 m (measured). */
const NEWEL_CLIMB = 3.7;
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

/** The flight along +z about x = 0 from `FLIGHT_FOOT_Z`, its landing after it, its party wall at +x and a banister at -x from before its foot (`newel`: from its first riser, its end a post there; `mirrored`: the wall at -x and the banister at +x). */
function flight(newel = false, mirrored = false): FloorBox[] {
  const boxes: FloorBox[] = [];
  const top = FLIGHT_FOOT_Z + TREAD_RUN * FLIGHT_STEPS;
  for (let s = 0; s < FLIGHT_STEPS; s++) {
    boxes.push({ x0: -FLIGHT_HALF, x1: FLIGHT_HALF, z0: FLIGHT_FOOT_Z + TREAD_RUN * s, z1: FLIGHT_FOOT_Z + TREAD_RUN * (s + 1), y0: 0, y1: MAX_RISER * (s + 1) });
  }
  boxes.push({ x0: -FLIGHT_HALF, x1: FLIGHT_HALF, z0: top, z1: top + 30, y0: 0, y1: MAX_RISER * FLIGHT_STEPS });
  const side = (box: FloorBox): FloorBox => (mirrored ? { ...box, x0: -box.x1, x1: -box.x0 } : box);
  boxes.push(side({ x0: FLIGHT_HALF, x1: FLIGHT_HALF + 0.3, z0: -2, z1: top + 30, y0: 0, y1: MAX_RISER * FLIGHT_STEPS + 3 }));
  boxes.push(side({ x0: -FLIGHT_HALF - 0.06, x1: -FLIGHT_HALF, z0: newel ? FLIGHT_FOOT_Z : -2, z1: top + 30, y0: 0, y1: MAX_RISER * FLIGHT_STEPS + 1 }));
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
  { it: "when he runs up it 5 degrees into the banister, then he keeps his feet and his strength", x: 0.2, heading: -5 * DEG, command: RUN_SPEED },
  { it: "when he walks up it across to the party wall at 10 degrees, then he keeps his feet and his strength", x: -0.2, heading: 10 * DEG, command: WALK_SPEED },
  // mutation (a sprint ramps as a run on the treads): sed -i 's/^      const top = share < 1 ? Math.min(command, RUN_SPEED) : command;/      const top = command;/' src/game/present/walker-floor.ts
  { it: "when he sprints straight up it beside the party wall, then he keeps his feet and his strength", x: 0.2, heading: 0, command: SPRINT_SPEED },
  { it: "when he runs up it 10 degrees into the banister, then he keeps his feet and his strength", x: 0, heading: -10 * DEG, command: RUN_SPEED },
];

// mutation (the runs): sed -i 's/^      return Math.min(command, STEP_PACE + (top - STEP_PACE) \* share, braking);/      return Math.min(command, STEP_PACE + (top - STEP_PACE) * share);/' src/game/present/walker-floor.ts
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

  // mutation (the post's end holds his shoulder): sed -i 's/^    const aside = Math.max(-SIDESTEP_SPEED \* dt, Math.min(SIDESTEP_SPEED \* dt, edge));/    const aside = 0;/' src/game/present/ragdoll-walker.ts
  it("when he walks up it 10 degrees into the banister, its end a post at the first riser, then he sidesteps the post, keeps his feet and his strength, and climbs it", async () => {
    const sys = await standingAmong(flight(true), -0.2);
    const start = sys["dolls"][WALKER_SLOT]!.bodies[0]!.translation().z;
    const climb = walk(sys, -10 * DEG, WALK_SPEED, CLIMB_SECONDS);
    expect(climb.fell, "he stayed on his feet").toBe(false);
    expect(climb.least, `least strength ${climb.least.toFixed(2)}`).toBeGreaterThanOrEqual(UNSHAKEN);
    expect(climb.z - start, `he went up the flight: ${(climb.z - start).toFixed(2)} m`).toBeGreaterThan(NEWEL_CLIMB);
  });

  // mutation (a part of him through the banister carries him back and forth across it): sed -i 's/^      if (x \* this.carried\[0\]! + z \* this.carried\[1\]! < 0) {/      if (false) {/' src/game/present/ragdoll-walker.ts
  it("when he walks 20 degrees into the banister from beside it, past the post at its end and on along its outside, then he keeps his feet and his strength", async () => {
    const sys = await standingAmong(flight(true), -0.2);
    const along = walk(sys, -20 * DEG, WALK_SPEED, CLIMB_SECONDS);
    expect(along.fell, "he stayed on his feet").toBe(false);
    expect(along.least, `least strength ${along.least.toFixed(2)}`).toBeGreaterThanOrEqual(UNSHAKEN);
  });

  // mutation (a riser under his lagging root reads a stride away, and he speeds into a skipped tread): sed -i '/^    if (this.stepAt(x, z, sin, cos, 0)) return STEP_PACE;/d' src/game/present/walker-floor.ts
  it("when he runs up it 10 degrees into the banister from 0.2 m toward the party wall, on the flight as built and on its mirror image, then both ways he keeps his feet and his strength and climbs it", async () => {
    for (const mirrored of [false, true]) {
      const sys = await standingAmong(flight(false, mirrored), mirrored ? -0.2 : 0.2);
      const start = sys["dolls"][WALKER_SLOT]!.bodies[0]!.translation().z;
      const climb = walk(sys, (mirrored ? 10 : -10) * DEG, RUN_SPEED, CLIMB_SECONDS);
      const way = mirrored ? "mirrored" : "as built";
      expect(climb.fell, `${way}: he stayed on his feet`).toBe(false);
      expect(climb.least, `${way}: least strength ${climb.least.toFixed(2)}`).toBeGreaterThanOrEqual(UNSHAKEN);
      expect(climb.z - start, `${way}: he went up the flight: ${(climb.z - start).toFixed(2)} m`).toBeGreaterThan(FLIGHT_FOOT_Z + TREAD_RUN * CLIMB_TREADS);
      sys.dispose();
      system = null;
    }
  });

  /** Each starts 0.2 m from the middle toward the banister, its end a post at the first riser, and heads into it (`mirrored`: the flight's mirror image, the banister at +x). */
  const newelCases: readonly { it: string; x: number; heading: number; command: number; mirrored: boolean }[] = [
    // mutation (his torso springing up in his own hop over a riser reads as a blow): sed -i '/^    if (this.hopUp > 0) dy = Math.min(0, dy);/d' src/game/present/ragdoll-walker.ts
    { it: "when he walks up its mirror image 5 degrees into the banister from beside the post, then he keeps his feet and his strength", x: 0.2, heading: 5 * DEG, command: WALK_SPEED, mirrored: true },
    // mutation (his torso springing up in his own hop over a riser reads as a blow): sed -i '/^    if (this.hopUp > 0) dy = Math.min(0, dy);/d' src/game/present/ragdoll-walker.ts
    { it: "when he runs up it 5 degrees into the banister from beside the post, then he keeps his feet and his strength", x: -0.2, heading: -5 * DEG, command: RUN_SPEED, mirrored: false },
    // mutation (his torso springing up in his own hop over a riser reads as a blow): sed -i '/^    if (this.hopUp > 0) dy = Math.min(0, dy);/d' src/game/present/ragdoll-walker.ts
    { it: "when he sprints up it 5 degrees into the banister from beside the post, then he keeps his feet and his strength", x: -0.2, heading: -5 * DEG, command: SPRINT_SPEED, mirrored: false },
    // mutation (his torso going out along getOut's carry past the post reads as a blow): sed -i 's/^    const carry = hypot2(this.carried\[0\]!, this.carried\[1\]!);/    const carry = 0;/' src/game/present/ragdoll-walker.ts
    { it: "when he sprints 20 degrees into the banister from beside it, past the post at its end and on along its outside, then he keeps his feet and his strength", x: -0.2, heading: -20 * DEG, command: SPRINT_SPEED, mirrored: false },
  ];
  for (const testCase of newelCases) {
    it(testCase.it, async () => {
      const sys = await standingAmong(flight(true, testCase.mirrored), testCase.x);
      const climb = walk(sys, testCase.heading, testCase.command, CLIMB_SECONDS);
      expect(climb.fell, "he stayed on his feet").toBe(false);
      expect(climb.least, `least strength ${climb.least.toFixed(2)}`).toBeGreaterThanOrEqual(UNSHAKEN);
    });
  }
});

/** A tread of the flight a step from the landing, and a spot across the banister from the middle of the flight at that tread. */
const TREAD = FLIGHT_STEPS - 2;
const TREAD_Z = FLIGHT_FOOT_Z + TREAD_RUN * (TREAD + 0.5);
const ACROSS_X = -FLIGHT_HALF - 0.25;

describe("given the walker standing on a high tread of the flight, the banister beside him", () => {
  // mutation (a foot across the banister reads the floor beyond it): sed -i 's/this.floor.walled(this.anchorPos\[0\]!, this.anchorPos\[2\]!, x, z) ? NO_FLOOR : this.floor.under(x, z)/this.floor.under(x, z)/' src/game/present/ragdoll-walker.ts
  // mutation (no floor reads as the ground's 0): sed -i 's/^    return height !== NO_FLOOR ? height : this.floor.level;/    return height !== NO_FLOOR ? height : 0;/' src/game/present/ragdoll-walker.ts
  it("when a foot is set across the banister, then it reads the tread he stands on, not the floor below the flight", () => {
    const walker = new Walker();
    walker.floor.boxes = flight();
    walker.floor.reset(0, MAX_RISER * (TREAD + 1) + PARTS[0].c[1], TREAD_Z);
    walker["anchorPos"][2] = TREAD_Z;
    expect(walker.floor.level, "control: he stands on the tread").toBeCloseTo(MAX_RISER * (TREAD + 1), 6);
    expect(walker["groundAt"](ACROSS_X, TREAD_Z), "the floor under a foot across the banister (m)").toBeCloseTo(walker.floor.level, 6);
  });

  // mutation (a foot planted across the banister sets his floor): sed -i 's/^      if (planted\[f\] !== 1 || this.walled(fromX, fromZ, plant\[f \* 3\]!, plant\[f \* 3 + 2\]!)) continue;/      if (planted[f] !== 1) continue;/' src/game/present/walker-floor.ts
  it("when one foot is planted across the banister, then his floor stays the tread and he is not read as mid-step (a fall would be missed)", () => {
    const floor = new WalkFloor();
    floor.boxes = flight();
    const tread = MAX_RISER * (TREAD + 1);
    floor.reset(0, tread + PARTS[0].c[1], TREAD_Z);
    floor.stand(Uint8Array.of(1, 1), Float64Array.of(0, tread, TREAD_Z, ACROSS_X, 0, TREAD_Z), 0, TREAD_Z);
    expect(floor.level, "his floor (m)").toBeCloseTo(tread, 6);
    expect(floor.rise, "how far his floor stands over his other foot's (m)").toBe(0);
  });
});
