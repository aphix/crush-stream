import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { DeformableCar } from "./car.ts";
import { BARRIER_HALF, BARRIER_TOP, physicsSlice } from "../contact/sat.ts";
import type { DeformMode } from "../deform/deform-rig.ts";
import { mass, paint } from "./test-support.ts";
import { makeCar, makeWorld, pooledCar, runWall, tickWorld } from "../contact/crash-scenarios.test-util.ts";
import { CLASSES, VEHICLE_CLASS_IDS } from "./vehicle-classes.ts";
import { stepWorld } from "../engine/world-step.ts";
import { DRAFT } from "../match/session.ts";
import { FINE_HZ, FRAME_HZ } from "../kernel/constants.ts";

/** Engine-block travel toward the cabin at rest after a hit (m). */
function blockTravel(car: DeformableCar): number {
  return Math.max(mass(car.deform, "engineL").rest.z - mass(car.deform, "engineL").local.z, mass(car.deform, "engineR").rest.z - mass(car.deform, "engineR").local.z);
}

/** Nose-to-block length (m): the sedan's 0.827 at rest, packed to its rig's `packGap` 0.527 (beam and radiator flat ahead of the block). */
function noseGap(car: DeformableCar): number {
  const d = car.deform;
  return Math.min(mass(d, "bumperFL").local.z, mass(d, "bumperFR").local.z) - Math.max(mass(d, "engineL").local.z, mass(d, "engineR").local.z);
}

// Owner's crumple model: a zone with stroke left absorbs the hit; one crushed to its packed length
// absorbs nothing more and passes the load to the next node (the block), so damage accumulates.
// Each runs at main's squash 0.4 and the calibrated 0.32 (lane/calib-defaults).
const SQUASHES = [0.4, 0.32];
/**
 * The repeated hit (km/h), and the speeds of one hit that carries the energy of two and of three of it. Hits of v kill on the third when
 * v·√2 is under the sedan's single-hit kill speed and v·√3 over it, at both settings; v sits in the middle of the window that holds for
 * both, so a few km/h of the kill speed (a reshaped nose, a rig re-derived) does not move which hit kills. A v at the window's edge
 * kills on the second at one setting.
 */
const REPEAT_KPH = 33;
const TWO_HITS_KPH = REPEAT_KPH * Math.SQRT2;
const THREE_HITS_KPH = REPEAT_KPH * Math.sqrt(3);

describe("given a car driving front-first into a rigid wall in shape deform mode, at either crumple-zone setting (0.4, or the calibrated 0.32)", () => {
  it("when it hits at 20, 25, 30, 35, 40 or 43 km/h, then the engine block stays on its mounts for as long as the nose has not packed against it", () => {
    for (const squash of SQUASHES) {
      for (const kph of [20, 25, 30, 35, 40, 43]) {
        const car = makeCar("shape", squash);
        runWall(kph, 1, "front", { car });
        if (noseGap(car) > car.frame.rig.packGap + 0.02) expect(blockTravel(car), `squash ${squash}, ${kph} km/h: block moved ${blockTravel(car).toFixed(4)} m with ${noseGap(car).toFixed(3)} m of nose left`).toBeLessThanOrEqual(0.045);
      }
    }
  });

  // Fixture: the slowest hit that packs the nose at both squashes (52 km/h; 50 left 0.547 m at 0.32). A
  // wreck resting on the slab used to sit 0.47 m nose-to-block after the second hit: the face pushed the
  // bumpers back after the clamp's pack rule, so the packed nose crushed past its packed length.
  it("when a 52 km/h hit has packed the nose and a 35 km/h hit follows, then the packed nose takes nothing more of the second hit and the engine block takes it instead", () => {
    for (const squash of SQUASHES) {
      const car = makeCar("shape", squash);
      runWall(52, 1, "front", { car });
      const gap = noseGap(car);
      const block = blockTravel(car);
      expect(gap, `squash ${squash} fixture: 52 km/h left ${gap.toFixed(3)} m of nose, not packed to ${car.frame.rig.packGap.toFixed(3)}`).toBeLessThanOrEqual(car.frame.rig.packGap + 0.005);
      runWall(35, 1, "front", { car });
      expect(gap - noseGap(car), `squash ${squash}: the packed nose shortened ${(gap - noseGap(car)).toFixed(3)} m more`).toBeLessThan(0.02);
      expect(blockTravel(car) - block, `squash ${squash}: the block took ${(blockTravel(car) - block).toFixed(3)} m of the second hit`).toBeGreaterThan(0.04);
    }
  });

  // Basis: rearmHit adds each hit's EBS² to the struck end (a linear spring's energy), so n hits at v
  // carry one hit's energy at v·√n: two hits' is under the single-hit kill speed at either setting, three's over it.
  // Was hit 4 at squash 0.32 and hit 2 at 0.4 (geometric re-hit peaks).
  it(`when it takes ${REPEAT_KPH} km/h wall hits one after another, then the engine block keeps moving back with every hit and the engine is killed on the third, at either setting`, () => {
    for (const squash of SQUASHES) {
      const car = makeCar("shape", squash);
      const travel: number[] = [];
      let killedAt = 0;
      for (let k = 1; k <= 4; k++) {
        runWall(REPEAT_KPH, 1, "front", { car });
        travel.push(blockTravel(car));
        if (!car.deform.drivetrainAlive && !killedAt) killedAt = k;
      }
      const row = travel.map((t) => t.toFixed(3)).join(" ");
      for (let k = 1; k < travel.length; k++) expect(travel[k]!, `squash ${squash}: block travel by hit ${row}`).toBeGreaterThanOrEqual(travel[k - 1]! - 0.005);
      expect(killedAt, `squash ${squash}: killed at hit ${killedAt || "never"}; block travel by hit ${row}`).toBe(3);
    }
  });

  it(`when one hit carries the energy of two ${REPEAT_KPH} km/h hits (${TWO_HITS_KPH.toFixed(1)} km/h) or of three (${THREE_HITS_KPH.toFixed(1)} km/h), then the first leaves the engine running and the second kills it, at either setting`, () => {
    for (const squash of SQUASHES) {
      const alive = (kph: number) => {
        const car = makeCar("shape", squash);
        runWall(kph, 1, "front", { car });
        return car.deform.drivetrainAlive;
      };
      const [a, b] = [alive(TWO_HITS_KPH), alive(THREE_HITS_KPH)];
      expect(a && !b, `squash ${squash}: ${TWO_HITS_KPH.toFixed(1)} km/h alive ${a}, ${THREE_HITS_KPH.toFixed(1)} km/h alive ${b}`).toBeTruthy();
    }
  });

  // A tyre that stopped past the slab's middle was pushed on through it (its point at rest left by the nearest face, the far one) and the
  // car stood on its nose with its front hubs inside the slab; it leaves by the side the car stands on, so the slab tears the tyres off
  // and the truck goes over it.
  it("when a monster hits the slab at 48 km/h, then none of its hubs ends inside the slab", () => {
    const car = new DeformableCar(paint(), new THREE.Scene(), null, "monster");
    car.deform.setMode("shape");
    runWall(48, 1, "front", { car });
    for (const name of ["hubFL", "hubFR", "hubRL", "hubRR"]) {
      const at = mass(car.deform, name).world;
      expect(Math.abs(at.x) >= BARRIER_HALF.x || Math.abs(at.z) >= BARRIER_HALF.z || at.y >= BARRIER_TOP, `${name} at (${at.x.toFixed(2)}, ${at.y.toFixed(2)}, ${at.z.toFixed(2)}) inside the slab`).toBeTruthy();
    }
  });
});

/** Jersey slab along Z, thin in X. Car drives -X into the +X face. */
function spawnAtBarrier(z: number, speed: number, mode: DeformMode): DeformableCar {
  const scene = new THREE.Scene();
  const car = new DeformableCar(paint(), scene);
  car.deform.setMode(mode);
  car.group.position.set(6.2, 0, z);
  car.group.rotation.set(0, -Math.PI / 2, 0, "YXZ");
  car.refreshBasis();
  car.velocity.set(-speed, 0, 0);
  car.speed = speed;
  car.spawnSpeed = speed;
  car.deform.bindKinematic(car.group, car.velocity, car.angular);
  return car;
}

/** `simSec` of the engine's step against the held slab, in steps of at most `frameDt` (tiny wall frames are slomo). */
function runFor(car: DeformableCar, simSec: number, frameDt: number): void {
  const w = makeWorld([car], true, false, null).world;
  let t = 0;
  while (t < simSec) {
    const h = physicsSlice(Math.min(frameDt, simSec - t), car.speed);
    stepWorld(w, h);
    car.updateSkin();
    t += h;
  }
}

const slabStopCases = [
  { it: "when it hits at 22 m/s at full speed in shape deform mode, then it does not tunnel through the slab and is flagged crashed", frameDt: 1 / FRAME_HZ, tunnelledMessage: "tunneled" },
  { it: "when the same 22 m/s hit runs in slow motion (tiny frame steps), then it also stops on the slab and is flagged crashed", frameDt: 1 / FINE_HZ, tunnelledMessage: "slomo tunneled" },
] as const;

describe("given a car driving into the face of a jersey barrier (a thin concrete slab across its path)", () => {
  for (const testCase of slabStopCases) {
    it(testCase.it, () => {
      const car = spawnAtBarrier(0, 22, "shape");
      runFor(car, 0.55, testCase.frameDt);
      expect(car.group.position.x, `${testCase.tunnelledMessage} to x=${car.group.position.x.toFixed(3)}`).toBeGreaterThan(0.45);
      expect(car.crashed).toBe(true);
    });
  }

  it("when the same 22 m/s hit runs at full speed and in slow motion, then both leave the nose on the same side of the slab and the crushed noses differ by under 0.55 m", () => {
    const fast = spawnAtBarrier(0, 22, "shape");
    const slow = spawnAtBarrier(0, 22, "shape");
    runFor(fast, 0.5, 1 / FRAME_HZ);
    runFor(slow, 0.5, 1 / FINE_HZ);
    expect(fast.group.position.x > 0.45 && slow.group.position.x > 0.45).toBeTruthy();
    const dz = Math.abs(
      mass(fast.deform, "bumperFL").local.z + mass(fast.deform, "bumperFR").local.z
        - (mass(slow.deform, "bumperFL").local.z + mass(slow.deform, "bumperFR").local.z),
    );
    expect(dz, `slomo/full crush diverged Δz=${dz.toFixed(3)}`).toBeLessThan(0.55);
  });

  it("when it hits at 20 m/s with the car 1.88 m off the slab's middle, then the front-left corner on the slab crushes more than the front-right corner hanging off its end, and the contact is on the car's left side", () => {
    const car = spawnAtBarrier(1.88, 20, "shape");
    runFor(car, 0.5, 1 / FRAME_HZ);
    const fl = mass(car.deform, "bumperFL").local.z;
    const fr = mass(car.deform, "bumperFR").local.z;
    const hit = car.deform.impactLocal;
    // yaw=-π/2: right is +Z, so FR hangs off the +Z end of the jersey; FL is on the slab.
    expect(fl, `wrong corner FL.z=${fl.toFixed(3)} FR.z=${fr.toFixed(3)} impactLocal=(${hit.x.toFixed(2)},${hit.z.toFixed(2)})`).toBeLessThan(fr - 0.04);
    // The contact is the pressure centre of the hulls on the face (`faceOverlap`: the mean of the hulls about as deep as the deepest),
    // and the hit is half on the face: it lies on the car's left, 0.17 m off the centre line (the old SAT gave the hull's own centre).
    expect(hit.x, `contact sat on the right of the centerline x=${hit.x.toFixed(2)}`).toBeLessThan(0);
  });

  it("when a car in lattice deform mode hits at 22 m/s at full speed, then it does not tunnel through the slab either", () => {
    const car = spawnAtBarrier(0, 22, "lattice");
    runFor(car, 0.55, 1 / FRAME_HZ);
    expect(car.group.position.x, `lattice tunneled x=${car.group.position.x.toFixed(3)}`).toBeGreaterThan(0.4);
  });
});

/**
 * The fastest a driven car goes: every class's top speed × its boost top × a race draft's top. resolveCarPair capped each slice's
 * impulse at 18 + 36·pass N·s, so a t-bone into a parked car pushed the struck car at only ~17 m/s² while the
 * bullet's closing ground on for ~0.8 s: from 58 m/s the bullet's nose came out of the struck car's far side in
 * 1–4 of 8 contact phases. A t-bone is judged by that nose, not the origins: once the pair turns the bullet can
 * slide off round the struck car's end, its origin passing the struck car's along X without going through it.
 */
const DRIVEN_TOP = Math.max(...VEHICLE_CLASS_IDS.map((id) => CLASSES[id].topSpeed * CLASSES[id].boostTop)) * DRAFT.top;

/** `struck`'s plan axes as the hit begins: a struck wreck turns on afterwards, and the sides it then has are not the ones the bullet is judged against. */
type Sides = { right: THREE.Vector3; forward: THREE.Vector3 };

function sidesOf(struck: DeformableCar): Sides {
  return { right: struck.rightFlat.clone(), forward: struck.fwdFlat.clone() };
}

/** Deepest front-bumper mass of `bullet` out past `struck`'s far side, inside its length (m), against `sides`; the bullet starts on its right. */
function noseThrough(struck: DeformableCar, bullet: DeformableCar, sides: Sides): number {
  let halfW = 0;
  let halfL = 0;
  for (const m of struck.deform.masses) {
    halfW = Math.max(halfW, Math.abs(m.rest.x));
    halfL = Math.max(halfL, Math.abs(m.rest.z));
  }
  let deepest = -Infinity;
  for (const m of bullet.deform.masses) {
    if (!m.name.startsWith("bumperF")) continue;
    const dx = m.world.x - struck.group.position.x;
    const dz = m.world.z - struck.group.position.z;
    const across = dx * sides.right.x + dz * sides.right.z;
    if (Math.abs(dx * sides.forward.x + dz * sides.forward.z) < halfL) deepest = Math.max(deepest, -across - halfW);
  }
  return deepest;
}

/** Frames (1/60 s) the closest approach must hold, the cars parted and moving away, before a hit is over; a run is 90 frames at most. */
const HIT_OVER_FRAMES = 30;

describe("given the top speed any driven car can reach (every class's top speed × its boost top × a race draft's top)", () => {
  it(`when a car hits the jersey slab at ${(DRIVEN_TOP * 3.6).toFixed(0)} km/h in shape or in lattice deform mode, then it stops on the slab instead of tunnelling through`, () => {
    for (const mode of ["shape", "lattice"] as const) {
      const car = spawnAtBarrier(0, DRIVEN_TOP, mode);
      runFor(car, 0.55, 1 / FRAME_HZ);
      expect(car.group.position.x, `${mode} tunneled to x=${car.group.position.x.toFixed(3)}`).toBeGreaterThan(0.4);
    }
  });

  for (const kind of ["head-on", "t-bone"] as const) {
    it(`when ${kind === "head-on" ? "two cars drive head-on at each other" : "a car drives broadside into a parked one"} at 54–80 m/s and at ${(DRIVEN_TOP * 3.6).toFixed(0)} km/h, then neither is carried through the other, whatever phase of the physics step the contact starts in`, () => {
      for (const v of [54, 57, 60, 65, 70, 75, 80, DRIVEN_TOP]) {
        // Along X: a heads +X from the left (head-on) or sits broadside at the origin (t-bone); b heads −X from the
        // right. b's start steps through one 1/240 s slice of its travel in 8 so contact lands at every phase.
        for (let k = 0; k < 8; k++) {
          const start = 6 + (k * v) / FINE_HZ / 8;
          const a = pooledCar(0);
          const b = pooledCar(1);
          a.spawnFacing(kind === "head-on" ? -6 : 0, 0, kind === "head-on" ? Math.PI / 2 : 0, 0);
          a.velocity.set(kind === "head-on" ? v : 0, 0, 0);
          a.speed = a.velocity.length();
          b.spawnFacing(start, 0, -Math.PI / 2, 0);
          b.velocity.set(-v, 0, 0);
          b.speed = v;
          const w = makeWorld([a, b], false, false, null);
          const sides = sidesOf(a);
          let worst = kind === "head-on" ? Infinity : -Infinity;
          let held = 0;
          for (let f = 0; f < 90 && held < HIT_OVER_FRAMES; f++) {
            tickWorld(w);
            const closest = kind === "head-on" ? Math.min(worst, b.group.position.x - a.group.position.x) : Math.max(worst, noseThrough(a, b, sides));
            held = closest === worst ? held + 1 : 0;
            worst = closest;
          }
          if (kind === "head-on") expect(worst, `${v.toFixed(1)} m/s from x=${start.toFixed(3)}: b's origin crossed a's along the hit by ${(-worst).toFixed(2)} m`).toBeGreaterThan(0);
          else expect(worst, `${v.toFixed(1)} m/s from x=${start.toFixed(3)}: b's nose came out ${worst.toFixed(2)} m past a's far side`).toBeLessThanOrEqual(0);
        }
      }
    });
  }
});

/**
 * ESV 98S3P12: a rigid full-width barrier overloads the front above ~50 km/h.
 * The block sits at the nose, so a tail-first hit has to cross the cabin first
 * and the same travel only kills around ~80 km/h.
 */
const FRONT_DISABLE_MPS = 50 / 3.6;
const REAR_DISABLE_MPS = 80 / 3.6;

const engineDisableFrontCases = [
  { it: "when it hits front-first at 35 km/h, under the 50 km/h limit, then the engine block survives and the car stays driveable", speedFactor: 0.7, simSec: 1.3, expectedAlive: true, message: "35 km/h wall should not kill the block" },
  { it: "when it hits front-first at 62 km/h, over the 50 km/h limit, then the engine is killed", speedFactor: 1.25, simSec: 1.5, expectedAlive: false, message: "62 km/h wall should kill the block" },
] as const;

describe("given a car hitting a rigid wall in shape deform mode, which kills the engine above about 50 km/h front-first and about 80 km/h back-first", () => {
  for (const testCase of engineDisableFrontCases) {
    it(testCase.it, () => {
      const car = spawnAtBarrier(0, FRONT_DISABLE_MPS * testCase.speedFactor, "shape");
      runFor(car, testCase.simSec, 1 / FRAME_HZ);
      expect(car.deform.drivetrainAlive, testCase.message).toBe(testCase.expectedAlive);
    });
  }

  it("when it backs into the wall at 40 km/h, well under the 80 km/h limit, then the engine block survives and the car stays driveable", () => {
    const speed = REAR_DISABLE_MPS * 0.5;
    const car = spawnAtBarrier(0, speed, "shape");
    car.yaw = Math.PI / 2;
    car.group.rotation.set(0, car.yaw, 0, "YXZ");
    car.refreshBasis();
    car.velocity.set(-speed, 0, 0);
    car.deform.bindKinematic(car.group, car.velocity, car.angular);
    runFor(car, 1.3, 1 / FRAME_HZ);
    expect(car.deform.drivetrainAlive, "40 km/h tail-first wall should still drive").toBe(true);
  });
});

/** NCAP/IIHS full-frontal sedan [09]: 0.35–0.55 m dynamic, 0.25–0.45 m permanent, 90–140 ms. */
describe("given a sedan hitting a rigid wall (NCAP/IIHS full-frontal sedan targets)", () => {
  const wall56 = runWall(56);

  it("when it hits square-on at 56 km/h, then both front corners are left with 0.25–0.50 m of permanent crush", () => {
    for (const short of [wall56.noseShortL, wall56.noseShortR]) {
      expect(short >= 0.25 && short <= 0.5, `nose L=${wall56.noseShortL.toFixed(3)} R=${wall56.noseShortR.toFixed(3)}`).toBeTruthy();
    }
  });

  it("when it hits square-on at 56 km/h, then no point of the car's crush model ends up more than 5 cm past the wall's face", () => {
    expect(wall56.maxCentrePastFace, `mass centre ${wall56.maxCentrePastFace.toFixed(3)} m past the face`).toBeLessThanOrEqual(0.05);
  });

  it("when it hits square-on at 56 km/h, then the car travels 0.35–0.60 m after contact and the impact pulse lasts 60–150 ms", () => {
    expect(wall56.comTravel >= 0.35 && wall56.comTravel <= 0.6, `COM travel ${wall56.comTravel.toFixed(3)}`).toBeTruthy();
    expect(wall56.pulseMs >= 60 && wall56.pulseMs <= 150, `pulse ${wall56.pulseMs.toFixed(0)} ms`).toBeTruthy();
  });

  it("when it hits square-on at 56 km/h, then it stays centred: the front-left and front-right corners shorten to within 25 % of each other", () => {
    const lo = Math.min(wall56.noseShortL, wall56.noseShortR);
    const hi = Math.max(wall56.noseShortL, wall56.noseShortR);
    expect(lo, `FL=${wall56.noseShortL.toFixed(3)} FR=${wall56.noseShortR.toFixed(3)}`).toBeGreaterThanOrEqual(hi * 0.75);
  });

  it("when it hits at 35, 56 and 80 km/h, then the distance the car travels after contact grows with speed", () => {
    const t35 = runWall(35).comTravel;
    const t80 = runWall(80).comTravel;
    expect(t35 < wall56.comTravel && wall56.comTravel < t80, `35=${t35.toFixed(3)} 56=${wall56.comTravel.toFixed(3)} 80=${t80.toFixed(3)}`).toBeTruthy();
  });

  it("when it reverses into the wall at 50 km/h, then the tail crushes by at least 0.15 m and the nose by at most 3 cm", () => {
    const r = runWall(50, 1, "rear");
    expect(r.tailShort, `tail ${r.tailShort.toFixed(3)}`).toBeGreaterThanOrEqual(0.15);
    expect(Math.max(r.noseShortL, r.noseShortR), `nose L=${r.noseShortL.toFixed(3)} R=${r.noseShortR.toFixed(3)}`).toBeLessThanOrEqual(0.03);
  });

  it("when it reverses into the wall at 50 km/h, then the tail crushes 0.6–1.0× as far as the nose does in a 50 km/h front hit, and the cabin moves in by under 6 cm", () => {
    const front = runWall(50);
    const rear = runWall(50, 1, "rear");
    const nose = Math.max(front.noseShortL, front.noseShortR);
    expect(rear.tailShort >= 0.6 * nose && rear.tailShort <= nose, `tail ${rear.tailShort.toFixed(3)} vs nose ${nose.toFixed(3)}`).toBeTruthy();
    expect(rear.cabinIntrusion, `cabin intrusion ${rear.cabinIntrusion.toFixed(3)}`).toBeLessThan(0.06);
  });

  it("when it slides sideways into the wall at 50 km/h, then the door dents 0.12–0.28 m, the nose and tail each crush under 10 cm and the cabin shifts under 12 cm", () => {
    const s = runWall(50, 1, "side");
    expect(s.doorMaxL >= 0.12 && s.doorMaxL <= 0.28, `doorL ${s.doorMaxL.toFixed(3)}`).toBeTruthy();
    expect(Math.max(s.noseShortL, s.noseShortR) < 0.1 && s.tailShort < 0.1, `nose L=${s.noseShortL.toFixed(3)} R=${s.noseShortR.toFixed(3)} tail=${s.tailShort.toFixed(3)}`).toBeTruthy();
    expect(s.cellShift, `cell moved ${s.cellShift.toFixed(3)}`).toBeLessThan(0.12);
  });
});
