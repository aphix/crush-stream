import { afterEach, describe, it } from "vitest";
import * as THREE from "three";
import { FRAME_HZ } from "../kernel/constants.ts";
import { setGround } from "../world/ground.ts";
import { driverLook } from "./driver-look.ts";
import type { RagdollSystem } from "./engine-ragdoll.ts";
import { WALKER_SLOT } from "./ragdoll-pool.ts";
import { PROBE } from "./ragdoll-walker.ts";
import { flatSystem } from "./ragdoll-throws.test-util.ts";
import type { FloorBox } from "./walker-floor.ts";
import { RUN_SPEED, SPRINT_SPEED, WALK_SPEED } from "./walker-locomotion.ts";

const FRAME = 1 / FRAME_HZ;
let system: RagdollSystem | null = null;
afterEach(() => {
  system?.dispose();
  system = null;
  setGround(null);
});

async function standing(boxes: FloorBox[], x: number, z: number, yaw: number): Promise<RagdollSystem> {
  const sys = await flatSystem();
  system = sys;
  sys.setFixedBoxes(boxes);
  sys.startWalker(new THREE.Vector3(x, 0, z), yaw, { cop: false, look: driverLook(0, 0) });
  for (let f = 0; f < FRAME_HZ; f++) sys.update(FRAME, [], true, true, null);
  return sys;
}

function walk(sys: RagdollSystem, heading: number, command: number, seconds: number): { least: number; fell: boolean; z: number } {
  let least = 1;
  let fell = false;
  for (let f = 0; f < Math.round(seconds * FRAME_HZ); f++) {
    sys.walker.heading = heading;
    sys.walker.command = command;
    sys.walker.ask();
    sys.update(FRAME, [], true, true, null);
    least = Math.min(least, sys.walker.strength);
    fell ||= sys.walker.state !== "stand";
  }
  return { least, fell, z: sys["dolls"][WALKER_SLOT]!.bodies[0]!.translation().z };
}

describe("probe", () => {
  for (const deg of [5, 15, 30, 50]) {
    for (const speed of [WALK_SPEED, RUN_SPEED, SPRINT_SPEED]) {
      it(`wall ${deg} deg at ${speed}`, async () => {
        const sys = await standing([{ x0: 0.5, x1: 0.8, z0: -5, z1: 60, y0: 0, y1: 2.5 }], 0, 0, 0);
        const r = walk(sys, (deg * Math.PI) / 180, speed, 4);
        console.log(`WALL deg=${deg} speed=${speed} least=${r.least.toFixed(3)} fell=${r.fell} z=${r.z.toFixed(2)}`);
      });
    }
  }
});

/** An interior flight along +z: 16 treads of 0.19 m by 0.26 m, 0.9 m wide about x = 0, a wall at its +x side and a banister at its -x side. */
function flight(): FloorBox[] {
  const boxes: FloorBox[] = [];
  for (let s = 0; s < 16; s++) boxes.push({ x0: -0.45, x1: 0.45, z0: 1 + 0.26 * s, z1: 1 + 0.26 * (s + 1), y0: 0, y1: 0.19 * (s + 1) });
  boxes.push({ x0: -0.45, x1: 0.45, z0: 1 + 0.26 * 16, z1: 1 + 0.26 * 16 + 30, y0: 0, y1: 0.19 * 16 });
  boxes.push({ x0: 0.45, x1: 0.75, z0: -2, z1: 40, y0: 0, y1: 6 });
  boxes.push({ x0: -0.51, x1: -0.45, z0: -2, z1: 1 + 0.26 * 16, y0: 0, y1: 0.19 * 16 + 1 });
  return boxes;
}

describe("trace", () => {
  it("trace -5 walk", async () => {
    const sys = await standing(flight(), -0.2, 0, 0);
    PROBE.trace = true;
    const r = walk(sys, (-5 * Math.PI) / 180, WALK_SPEED, 8);
    PROBE.trace = false;
    console.log(`TRACE least=${r.least.toFixed(3)} fell=${r.fell} z=${r.z.toFixed(2)}`);
  });
});

describe("probe newel", () => {
  for (const x of [-0.05, -0.1, -0.15, -0.2, -0.25]) {
    for (const speed of [WALK_SPEED, RUN_SPEED, SPRINT_SPEED]) {
      it(`newel x ${x} at ${speed}`, async () => {
        const sys = await standing([{ x0: -0.6, x1: -0.54, z0: 2, z1: 30, y0: 0, y1: 2.5 }], x - 0.3, 0, 0);
        PROBE.cause = ""; PROBE.peak = 0; PROBE.worst.fill(0);
        const r = walk(sys, 0, speed, 5);
        console.log(`NEWEL x=${x} speed=${speed} least=${r.least.toFixed(3)} fell=${r.fell} z=${r.z.toFixed(2)} cause=${PROBE.cause} worst=${PROBE.worst.map((v) => v.toFixed(2)).join(",")}`);
      });
    }
  }
});

describe("probe stairs", () => {
  for (const deg of [0, 5, 10, 20, -5, -10, -20]) {
    for (const speed of [WALK_SPEED, RUN_SPEED, SPRINT_SPEED]) {
      it(`flight ${deg} deg at ${speed}`, async () => {
        const sys = await standing(flight(), deg >= 0 ? 0.2 : -0.2, 0, 0);
        PROBE.cause = ""; PROBE.peak = 0; PROBE.worst.fill(0);
        const r = walk(sys, (deg * Math.PI) / 180, speed, 8);
        console.log(`FLIGHT deg=${deg} speed=${speed} least=${r.least.toFixed(3)} fell=${r.fell} z=${r.z.toFixed(2)} cause=${PROBE.cause} worst=${PROBE.worst.map((v) => v.toFixed(2)).join(",")}`);
      });
    }
  }
});
