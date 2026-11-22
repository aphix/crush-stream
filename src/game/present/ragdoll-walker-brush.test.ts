import { afterEach, describe, expect, it } from "vitest";
import * as THREE from "three";
import { FRAME_HZ } from "../kernel/constants.ts";
import { detCos } from "../kernel/physics-core.js";
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
/** He starts this far (m) off the flight's middle, toward the side he leans into. */
const FLIGHT_START_X = 0.2;
/** A blow across his way (N·s on his chest) that his hold does not take out within a frame: a strike nobody modelled. */
const SIDE_BLOW = 1200;
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

/** The flight along +z about x = 0 from `FLIGHT_FOOT_Z`, its landing after it, its party wall at +x and a banister at -x from before its foot. */
function flight(): FloorBox[] {
  const boxes: FloorBox[] = [];
  const top = FLIGHT_FOOT_Z + TREAD_RUN * FLIGHT_STEPS;
  for (let s = 0; s < FLIGHT_STEPS; s++) {
    boxes.push({ x0: -FLIGHT_HALF, x1: FLIGHT_HALF, z0: FLIGHT_FOOT_Z + TREAD_RUN * s, z1: FLIGHT_FOOT_Z + TREAD_RUN * (s + 1), y0: 0, y1: MAX_RISER * (s + 1) });
  }
  boxes.push({ x0: -FLIGHT_HALF, x1: FLIGHT_HALF, z0: top, z1: top + 30, y0: 0, y1: MAX_RISER * FLIGHT_STEPS });
  boxes.push({ x0: FLIGHT_HALF, x1: FLIGHT_HALF + 0.3, z0: -2, z1: top + 30, y0: 0, y1: MAX_RISER * FLIGHT_STEPS + 3 });
  boxes.push({ x0: -FLIGHT_HALF - 0.06, x1: -FLIGHT_HALF, z0: -2, z1: top + 30, y0: 0, y1: MAX_RISER * FLIGHT_STEPS + 1 });
  return boxes;
}

describe("given the walker beside a wall on flat ground", () => {
  // mutation: sed -i 's/^    return Math.min(ahead, stopped);/    return ahead;/' /home/aphix/worktrees/Feel/src/game/present/ragdoll-walker.ts
  for (const speed of [RUN_SPEED, SPRINT_SPEED]) {
    it(`when he runs at ${speed} m/s into it at 30 degrees and slides along it, then he keeps his feet and his strength`, async () => {
      const sys = await standingAmong([WALL], 0);
      const run = walk(sys, 30 * DEG, speed, 4);
      expect(run.fell, "he stayed on his feet").toBe(false);
      expect(run.least, `least strength ${run.least.toFixed(2)}`).toBeGreaterThanOrEqual(UNSHAKEN);
    });
  }

  // mutation: sed -i 's/^    return Math.min(ahead, stopped);/    return 0;/' /home/aphix/worktrees/Feel/src/game/present/ragdoll-walker.ts
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

const flightCases: readonly { it: string; heading: number; command: number }[] = [
  { it: "when he runs straight up it, then he keeps his feet and his strength", heading: 0, command: RUN_SPEED },
  { it: "when he runs up it 5 degrees into the party wall, then he keeps his feet and his strength", heading: 5 * DEG, command: RUN_SPEED },
  { it: "when he walks up it 5 degrees into the banister, then he keeps his feet and his strength", heading: -5 * DEG, command: WALK_SPEED },
  { it: "when he walks up it 10 degrees into the banister, then he keeps his feet and his strength", heading: -10 * DEG, command: WALK_SPEED },
];

describe("given the walker at the foot of a rowhome's stair flight between its party wall and a banister", () => {
  // mutation: sed -i 's/^    const dy = Math.max(0, vy + HOLD_RATE \* ly \* keep);/    const dy = vy + HOLD_RATE * ly * keep;/' /home/aphix/worktrees/Feel/src/game/present/ragdoll-walker.ts
  for (const testCase of flightCases) {
    it(testCase.it, async () => {
      const sys = await standingAmong(flight(), testCase.heading < 0 ? -FLIGHT_START_X : FLIGHT_START_X);
      const start = sys["dolls"][WALKER_SLOT]!.bodies[0]!.translation().z;
      const climb = walk(sys, testCase.heading, testCase.command, 8);
      expect(climb.fell, "he stayed on his feet").toBe(false);
      expect(climb.least, `least strength ${climb.least.toFixed(2)}`).toBeGreaterThanOrEqual(UNSHAKEN);
      expect(climb.z - start, "he went on up the flight").toBeGreaterThan(FLIGHT_FOOT_Z + TREAD_RUN * 4 * detCos(testCase.heading));
    });
  }
});

describe("sweep", () => {
  for (const x of [0, 0.2, -0.2]) {
    for (const deg of [0, 5, 10, -5, -10]) {
      for (const speed of [WALK_SPEED, RUN_SPEED]) {
        it(`flight x ${x} deg ${deg} speed ${speed}`, async () => {
          const sys = await standingAmong(flight(), x);
          const w = sys.walker;
          const torso = sys["dolls"][WALKER_SLOT]!.bodies[0]!;
          let note = "";
          let prev = "";
          const c = walk(sys, deg * DEG, speed, 8, () => {
            const t = torso.translation();
            const q = torso.rotation();
            const up = 1 - 2 * (q.x * q.x + q.z * q.z);
            if (w.state !== "stand" && note === "") note = `FALL at ${t.x.toFixed(2)},${t.y.toFixed(2)},${t.z.toFixed(2)} up=${up.toFixed(2)} level=${w.floor.level.toFixed(2)} rise=${w.floor.rise.toFixed(2)} before: ${prev}`;
            prev = `s=${w.strength.toFixed(2)} up=${up.toFixed(2)} y-level=${(t.y - w.floor.level).toFixed(2)} speed=${w.loco.speed.toFixed(2)}`;
          });
          console.log(`SWEEP x=${x} deg=${deg} speed=${speed} least=${c.least.toFixed(3)} fell=${c.fell} z=${c.z.toFixed(2)} ${note}`);
        });
      }
    }
  }
  for (const blow of [600, 1200, 2400]) {
    for (const dir of [-1, 1]) {
      it(`blow ${blow} ${dir}`, async () => {
        const sys = await standingAmong([WALL], 0.1);
        const torso = sys["dolls"][WALKER_SLOT]!.bodies[0]!;
        const c = walk(sys, 5 * DEG, WALK_SPEED, 3, (f) => {
          if (f === FRAME_HZ) torso.applyImpulse(new THREE.Vector3(dir * blow, 0, 0), true);
          if (f === FRAME_HZ + 1) console.log(`v after ${torso.linvel().x.toFixed(2)} mass ${torso.mass().toFixed(1)}`);
        });
        console.log(`BLOW ${blow} dir=${dir} least=${c.least.toFixed(3)} fell=${c.fell}`);
      });
    }
  }
});

describe("trace", () => {
  it("trace x 0.2 deg -5 run", async () => {
    const sys = await standingAmong(flight(), 0.2);
    const w = sys.walker;
    const torso = sys["dolls"][WALKER_SLOT]!.bodies[0]!;
    let was = "stand";
    walk(sys, -5 * DEG, RUN_SPEED, 8, (f) => {
      const t = torso.translation();
      const q = torso.rotation();
      const up = 1 - 2 * (q.x * q.x + q.z * q.z);
      if (f % 4 === 0 || w.state !== was) console.log(`R f=${f} ${w.state} torso=${t.x.toFixed(2)},${t.y.toFixed(2)},${t.z.toFixed(2)} up=${up.toFixed(2)} speed=${w.loco.speed.toFixed(2)} level=${w.floor.level.toFixed(2)} rise=${w.floor.rise.toFixed(2)} root=${w["anchorPos"][0]!.toFixed(2)},${w["anchorPos"][1]!.toFixed(2)},${w["anchorPos"][2]!.toFixed(2)} s=${w.strength.toFixed(2)}`);
      was = w.state;
    });
  });
});
