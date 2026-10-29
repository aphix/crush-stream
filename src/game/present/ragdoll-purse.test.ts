import { describe, expect, it } from "vitest";
import * as THREE from "three";
import "../kernel/rapier-node.test-util.ts";
import type { RigidBody } from "@dimforge/rapier3d-simd";
import { driverLook } from "./driver-look.ts";
import { assertSameNumbers } from "../vehicle/test-support.ts";
import { ROLES } from "./dummy-rig.ts";
import { RagdollSystem } from "./engine-ragdoll.ts";
import { loadedRagdolls } from "./ragdoll-throws.test-util.ts";
import { Purses, BURST_AT, ITEM_SPEED, ITEMS_MIN, PURSE_SPEED, SPREAD } from "./ragdoll-purse.ts";
import { FREEWHEEL, launch, makeCar, makeWorld, tickWorld } from "../contact/crash-scenarios.test-util.ts";
import { armKill, DEFAULT_REALISM } from "../vehicle/vehicle-classes.ts";
import { THROW_ONSET } from "../match/phase.ts";
import { RANGE, RANGE_GROUND } from "../scenes/range.ts";
import { setGround } from "../world/ground.ts";
import { FRAME_HZ } from "../kernel/constants.ts";

// The old 120 Hz floor this suite pins its burst timing to, independent of the shipped rates.
const STEP_HZ = 120;
const STEP = 1 / STEP_HZ;
/** A throw out of a windscreen at 20 m/s: the torso's pose and velocity, as `RagdollSystem.eject` places them. */
const V = new THREE.Vector3(20, 3.5, 5);

function seedWhere(woman: boolean): number {
  for (let seed = 1; ; seed++) if (driverLook(seed, 0).woman === woman) return seed;
}

async function system(seed: number): Promise<RagdollSystem> {
  const ragdolls = await loadedRagdolls();
  ragdolls.lookSeed = seed;
  return ragdolls;
}

function throwOut(r: RagdollSystem, car = 0, cop = false): void {
  const t = { car, p: new THREE.Vector3(0, 1.4, 0), q: new THREE.Quaternion(), v: V.clone(), w: new THREE.Vector3(), age: 0, cop, rides: true };
  r["spawn"](t);
}

const purses = (r: RagdollSystem): Purses => r["purses"]!;
const bodiesOf = (r: RagdollSystem): RigidBody[] => purses(r)["bodies"][0]!;
const speed = (b: RigidBody) => Math.hypot(b.linvel().x, b.linvel().y, b.linvel().z);
const bits = (n: number) => n.toString(2).replaceAll("0", "").length;

/** Steps `r` one `STEP` at a time until set 0's things burst out; the steps it took. */
function untilBurst(r: RagdollSystem): number {
  for (let n = 1; n < 200; n++) {
    r.update(STEP, [], true, true, null);
    if (purses(r)["burstAt"][0]) return n;
  }
  throw new Error("the purse never burst");
}

/** How near (m) the range woman's handbag rests to her: it stops where it lands, 15.1 m behind her; the spin-cap fault this row guards left it 30 m off. */
const PURSE_NEAR = 16;
/** Where (m on) the range's thrown woman lies: she lands on her limbs and cartwheels on (owner: accepted), 41.5 m. */
const LANDING_M = [40.5, 42.5] as const;

describe("given a thrown crash-test dummy driver who may carry a handbag (a woman civilian) that bursts open into small items", () => {
  it("when a civilian woman is thrown, then 1 handbag leaves at 0.85× her speed on her heading and, at the burst, 4-7 items fly at 0.85× the handbag's speed inside the spread cone", async () => {
    const r = await system(seedWhere(true));
    throwOut(r);
    expect(purses(r).active(0)).toBeTruthy();
    const purse = bodiesOf(r)[0]!;
    expect(Math.abs(speed(purse) / V.length() - PURSE_SPEED), `purse ${(speed(purse) / V.length()).toFixed(4)} of her speed`).toBeLessThan(1e-3);
    const heading = V.clone().normalize();
    const pv = new THREE.Vector3().copy(purse.linvel()).normalize();
    expect(pv.dot(heading), "the purse leaves on her heading").toBeGreaterThan(0.99999);
    const steps = untilBurst(r);
    expect(Math.abs(steps * STEP - BURST_AT), `burst after ${steps} steps`).toBeLessThanOrEqual(STEP + 1e-9);
    const u = new THREE.Vector3().copy(purse.linvel());
    const items = bodiesOf(r).slice(1).filter((b) => b.isEnabled());
    expect(items.length >= ITEMS_MIN && items.length <= 7, `${items.length} things`).toBeTruthy();
    expect(bits(purses(r)["on"][0]! >> 1)).toBe(items.length);
    for (const b of items) {
      const v = new THREE.Vector3().copy(b.linvel());
      expect(Math.abs(v.length() / u.length() - ITEM_SPEED), `thing at ${(v.length() / u.length()).toFixed(4)} of the purse's speed`).toBeLessThan(5e-3);
      const angle = v.angleTo(u);
      expect(angle, `thing ${((angle * 180) / Math.PI).toFixed(1)}° off the purse's heading`).toBeLessThanOrEqual(Math.atan(SPREAD) + 1e-3);
      expect(v.dot(u), "same way").toBeGreaterThan(0);
    }
    r.dispose();
  });

  it("when a man is thrown, or a policewoman is thrown, then no handbag and no items appear", async () => {
    const man = await system(seedWhere(false));
    throwOut(man);
    for (let n = 0; n < 60; n++) man.update(STEP, [], true, true, null);
    expect(purses(man).active(0)).toBe(false);
    expect(bodiesOf(man).some((b) => b.isEnabled())).toBe(false);
    man.dispose();
    const cop = await system(seedWhere(true));
    throwOut(cop, 0, true);
    for (let n = 0; n < 60; n++) cop.update(STEP, [], true, true, null);
    expect(purses(cop).active(0), "a policewoman carries no purse").toBe(false);
    expect(bodiesOf(cop).some((b) => b.isEnabled())).toBe(false);
    cop.dispose();
  });

  it("when a civilian woman is thrown and 8 seconds pass, then the handbag and its items land on the ground, travel the way she went and come to rest", async () => {
    const r = await system(seedWhere(true));
    throwOut(r);
    let low = Infinity;
    for (let n = 0; n < 8 * STEP_HZ; n++) {
      r.update(STEP, [], true, true, null);
      for (const b of bodiesOf(r)) if (b.isEnabled()) low = Math.min(low, b.translation().y);
    }
    expect(low, `lowest centre ${low.toFixed(3)} m: nothing fell through the ground`).toBeGreaterThan(-0.05);
    const live = bodiesOf(r).filter((b) => b.isEnabled());
    expect(live.length).toBeGreaterThanOrEqual(1 + ITEMS_MIN);
    for (const b of live) {
      expect(b.translation().x, `rest at x = ${b.translation().x.toFixed(1)} m: it travelled her way`).toBeGreaterThan(5);
      expect(b.translation().y, "on the ground").toBeLessThan(0.3);
      expect(speed(b), `at rest (${speed(b).toFixed(2)} m/s)`).toBeLessThan(0.5);
    }
    r.dispose();
  });

  it("when the same throw is run twice with no randomness allowed, then the handbag and items end up in exactly the same places", async () => {
    const seed = seedWhere(true);
    const real = Math.random;
    const poses: number[][] = [];
    for (let run = 0; run < 2; run++) {
      const r = await system(seed);
      // (three.js itself draws UUIDs from it, so only the throw is under the stub.)
      Math.random = () => {
        throw new Error("Math.random in a ragdoll throw");
      };
      try {
        throwOut(r);
        for (let n = 0; n < 150; n++) r.update(STEP, [], true, true, null);
      } finally {
        Math.random = real;
      }
      poses.push(bodiesOf(r).flatMap((b) => (b.isEnabled() ? [b.translation().x, b.translation().y, b.translation().z] : [])));
      r.dispose();
    }
    expect(poses[0]!.length).toBeGreaterThanOrEqual(3 * (1 + ITEMS_MIN));
    assertSameNumbers(poses[0]!, poses[1]!, "the replayed throw");
  });

  it("when the dummy is removed, the game is reset, or the system is disposed, then the handbag and its items are cleared with it", async () => {
    const r = await system(seedWhere(true));
    throwOut(r);
    untilBurst(r);
    expect(bodiesOf(r).filter((b) => b.isEnabled()).length).toBeGreaterThanOrEqual(1 + ITEMS_MIN);
    r["despawn"](0);
    expect(purses(r).active(0)).toBe(false);
    expect(bodiesOf(r).some((b) => b.isEnabled()), "dummy gone, purse gone").toBe(false);
    expect(purses(r).mesh.count).toBe(0);
    throwOut(r);
    untilBurst(r);
    r.reset();
    expect(bodiesOf(r).some((b) => b.isEnabled()), "a new run clears the purse").toBe(false);
    throwOut(r);
    const scene = purses(r).mesh;
    r.dispose();
    expect(scene.parent, "dispose takes the props mesh out of the scene").toBe(null);
  });

  it("when a driver is thrown again after a reset, then he keeps the same look, and when the next race changes the look seed, the look changes", async () => {
    const r = await system(7);
    const colors = () => {
      const colour = new THREE.Color();
      return Float32Array.from({ length: r["dolls"].length * ROLES }, (_, i) => r["mesh"].colourOf(Math.floor(i / ROLES), i % ROLES, colour).getHex());
    };
    throwOut(r, 3);
    const first = colors();
    r.reset();
    throwOut(r, 3);
    assertSameNumbers(colors(), first, "the same tee and hair after a reset and a re-throw");
    r.reset();
    r.lookSeed = 8;
    throwOut(r, 3);
    expect(colors().some((v, i) => v !== first[i]), "the next race's driver looks different").toBeTruthy();
    r.dispose();
  });

  it(`when a civilian woman is thrown from a 100 km/h crash into the barrier on sand at the ejection range, then she lands ${LANDING_M[0]}-${LANDING_M[1]} m on, the handbag rests within ${PURSE_NEAR} m of her instead of 30 m on, and no body spins faster than the spin cap`, async () => {
    setGround(RANGE_GROUND);
    const car = makeCar("shape", 0.32, 0.45);
    armKill(car.deform, "sedan", DEFAULT_REALISM, "default");
    launch(car, -RANGE.run, 0, Math.PI / 2, RANGE.kph / 3.6, 0);
    const w = makeWorld([car], true, false, FREEWHEEL);
    w.onEject = (e) => r.launch(e, [car]);
    w.clock.slomoAt = THROW_ONSET;
    const r = await system(seedWhere(true));
    let spin = 0;
    let torso = NaN;
    let still = 0;
    for (let wall = 0; wall < 14 && still < 3; wall += 1 / FRAME_HZ) {
      tickWorld(w, 1 / FRAME_HZ);
      r.update((1 / FRAME_HZ) * w.clock.timeScale, [car], true, true, new THREE.Group());
      const d = r["dolls"].find((x) => x.live);
      if (!d) continue;
      for (const b of bodiesOf(r)) if (b.isEnabled()) spin = Math.max(spin, Math.hypot(b.angvel().x, b.angvel().y, b.angvel().z));
      torso = d.bodies[0]!.translation().x;
      still = d.still;
    }
    const purse = bodiesOf(r)[0]!.translation();
    r.dispose();
    // Before the spin cap: the purse spun at 79 rad/s, skipped on and came to rest 30 m past the dummy (58.6 m against 28.4 m).
    expect(torso > LANDING_M[0] && torso < LANDING_M[1], `she landed at ${torso.toFixed(1)} m`).toBeTruthy();
    expect(Math.abs(purse.x - torso), `the purse rests ${(purse.x - torso).toFixed(1)} m from her (she lies at ${torso.toFixed(1)} m)`).toBeLessThan(PURSE_NEAR);
    expect(spin, `fastest spin ${spin.toFixed(1)} rad/s`).toBeLessThanOrEqual(15.5);
  });
});
