import { describe, expect, it } from "vitest";
import * as THREE from "three";
import "../kernel/rapier-node.test-util.ts";
import { launch, makeCar } from "../contact/crash-scenarios.test-util.ts";
import type { DeformableCar } from "../vehicle/car.ts";
import { blankStrike, fell, runsDown } from "../scenes/figure-strike.ts";
import { RagdollSystem, type Throw } from "./engine-ragdoll.ts";
import { loadedRagdolls } from "./ragdoll-throws.test-util.ts";
import { PARTS } from "./ragdoll-body.ts";
import { COP_LOOK, GUARD_LOOK, VIP_LOOK } from "./dummy-dress.ts";
import { FRAME_HZ } from "../kernel/constants.ts";

const FIRST_WORKER_ID = 7;
const FRAME = 1 / FRAME_HZ;
/** Torso height (m) of the dummy standing on the ground (`PARTS`), and his upper arm's height hanging against raised over his head. */
const TORSO_STANDING = PARTS[0].c[1];
const ARM_HANGING = PARTS[2].c[1];
/** How far (m) ahead of the car's nose (its cage's plan box front, as `runsDown` reads it) a figure struck by it stands. */
const AHEAD = 0.25;

/** A car at `mps` m/s along +z, its nose `AHEAD` m short of the origin where guard `guard` stands, and the strike it makes (`fell`). */
function struck(guard: number, mps: number) {
  const car = makeCar();
  launch(car, 0.3, -car.cage.fields.planBox[3]! - AHEAD, 0, 0, mps);
  expect(runsDown(car, 0, 0, 0), "the car meets the figure").toBeTruthy();
  return { car, cars: [car], strike: fell(car, 0, guard, 0, 0, 0, 0, 1, blankStrike()) };
}

/** A ragdoll system whose dummies' world is a worker that only records the throws sent to it (the worker mode of a race course). */
function systemWithWorker() {
  const sent: { t: Throw; purse: boolean }[] = [];
  const worker = {
    throwDummy: (t: Throw, purse: boolean) => {
      sent.push({ t: { ...t, p: t.p.clone(), v: t.v.clone(), w: t.w.clone() }, purse });
      return FIRST_WORKER_ID + sent.length - 1;
    },
  };
  const ragdolls = new RagdollSystem(new THREE.Scene(), () => {}, () => {});
  ragdolls["mode"] = "remote";
  Object.assign(ragdolls, { remote: worker });
  return { ragdolls, sent };
}

/** Frames of the dummies' world with the car going on at `mps` along +z, `seconds` of them; the dummy in slot 0's torso then. */
function fly(ragdolls: RagdollSystem, car: DeformableCar, mps: number, seconds: number) {
  const p = new THREE.Vector3();
  const v = new THREE.Vector3();
  for (let t = 0; t < seconds; t += FRAME) {
    car.group.position.z += mps * FRAME;
    ragdolls.update(FRAME, [car], true, false, null);
  }
  ragdolls.torso(0, p, v);
  return { p, speed: v.length() };
}

const workerCases = [
  { it: "when a navy-uniformed guard is run down at 15 m/s, then one dummy is thrown from where he stood in his uniform, hands at his sides, flying with the car", guard: 0, expectedCop: true, expectedLook: COP_LOOK },
  { it: "when a black-suited guard is run down, then he is dressed as an agent", guard: 1, expectedCop: false, expectedLook: GUARD_LOOK },
  { it: "when the VIP is run down, then he is dressed as the portly man in the blue suit", guard: -1, expectedCop: false, expectedLook: VIP_LOOK },
] as const;

describe("given a race course's dummies simulated off the main thread and a standing figure a car ran down", () => {
  for (const testCase of workerCases) {
    it(testCase.it, () => {
      const { cars, strike } = struck(testCase.guard, 15);
      const { ragdolls, sent } = systemWithWorker();
      ragdolls.throwFigure(strike, cars);
      expect(sent.length, "one throw reached the worker").toBe(1);
      const { t, purse } = sent[0]!;
      expect(t.cop, "the navy uniform").toBe(testCase.expectedCop);
      expect(t.armsDown, "arms hanging, not raised over his head").toBe(true);
      expect(t.car, "he ignores the car that struck him at first").toBe(0);
      expect(t.rides, "the ride-along never frames him").toBe(false);
      expect(purse, "no purse").toBe(false);
      expect(Math.abs(t.p.y - TORSO_STANDING) < 1e-6 && Math.abs(t.p.x) < 1e-6 && Math.abs(t.p.z) < 1e-6, "his torso where he stood").toBeTruthy();
      expect(Math.abs(t.v.x - strike.vx) < 1e-6 && Math.abs(t.v.y - strike.vy) < 1e-6 && Math.abs(t.v.z - strike.vz) < 1e-6, "the strike's velocity").toBeTruthy();
      expect(ragdolls["dressing"].get(FIRST_WORKER_ID)!.look, "dressed from his own table: the cop's, the agent's or the VIP's").toBe(testCase.expectedLook);
    });
  }

  it("when a figure is run down right after a driver is thrown, then the driver's launch is left as set, with no hanging arms", () => {
    const { cars, strike } = struck(0, 15);
    const { ragdolls } = systemWithWorker();
    const before = ragdolls["next"].rides;
    ragdolls.throwFigure(strike, cars);
    expect(ragdolls["next"].rides, "the latest driver's record").toBe(before);
    expect(ragdolls["next"].armsDown, "no hanging arms on it").toBe(undefined);
  });

  it("when a figure is run down, then he leaves at the strike's own spin: none of the extra roll a thrown driver gets about his line of flight", () => {
    const { cars, strike } = struck(0, 15);
    const { ragdolls, sent } = systemWithWorker();
    ragdolls.throwFigure(strike, cars);
    const { t } = sent[0]!;
    const added = t.w.clone().sub(new THREE.Vector3(strike.wx, strike.wy, strike.wz));
    expect(t.v.length(), "the control: he flies").toBeGreaterThan(1);
    const roll = added.dot(t.v) / t.v.length();
    expect(Math.abs(roll), `${roll} rad/s about his line of flight`).toBeLessThan(1e-9);
    expect(added.length(), "spin past the strike's (rad/s)").toBe(0);
  });
});

describe("given the dummies simulated on the main thread (the fallback, and every scene that is not a race course) and a standing figure a car ran down", () => {
  it("when a car at 15 m/s runs him down, then one dummy is out standing with his hands down, flies on past the car's nose, lands to the side clear of its path and lies still", async () => {
    const { car, cars, strike } = struck(0, 15);
    const ragdolls = await loadedRagdolls();
    ragdolls.throwFigure(strike, cars);
    const dolls: { live: boolean; cur: Float32Array }[] = ragdolls["dolls"];
    const out = dolls.filter((d) => d.live);
    expect(out.length, "one dummy out").toBe(1);
    expect(Math.abs(out[0]!.cur[7 * 2 + 1]! - ARM_HANGING), "his upper arm hangs at his side").toBeLessThan(1e-3);
    const { p, speed } = fly(ragdolls, car, 15, 3);
    expect(p.z > 12 && p.z < 25, `he lies ${p.z.toFixed(1)} m along the car's way`).toBeTruthy();
    expect(Math.abs(p.x), `${Math.abs(p.x).toFixed(1)} m off the car's centre line, clear of its path`).toBeGreaterThan(1.2);
    expect(p.y, `lying on the ground at ${p.y.toFixed(2)} m`).toBeLessThan(0.3);
    expect(speed, `still, at ${speed.toFixed(2)} m/s`).toBeLessThan(0.2);
  });

  it("when the physics engine is not loaded yet, then he is thrown once it is, in the dress he was thrown in", async () => {
    const { car, cars, strike } = struck(1, 15);
    const ragdolls = new RagdollSystem(new THREE.Scene(), () => {}, () => {});
    ragdolls.throwFigure(strike, cars);
    expect(ragdolls["pending"].length, "waiting for Rapier").toBe(1);
    await ragdolls.preload();
    fly(ragdolls, car, 15, FRAME);
    const dolls: { live: boolean }[] = ragdolls["dolls"];
    expect(dolls.filter((d) => d.live).length, "thrown").toBe(1);
    expect(ragdolls["pending"].length, "nothing left waiting").toBe(0);
  });
});
