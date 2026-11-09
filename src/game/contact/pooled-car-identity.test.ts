import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { launch, makeCar, makeWorld, pooledCar, tickWorld } from "./crash-scenarios.test-util.ts";
import { physicsSlice } from "./sat.ts";
import { stepWorld } from "../engine/world-step.ts";
import { FRAME_HZ } from "../kernel/constants.ts";
import { arenaWorld, placeDerby } from "../scenes/derby-arena.test-util.ts";
import { setGround } from "../world/ground.ts";
import { classCar, dressAsClass } from "../vehicle/ejection.test-util.ts";
import { pooled } from "../vehicle/ground-probe.test-util.ts";
import type { DeformableCar } from "../vehicle/car.ts";
import type { VehicleClassId } from "../vehicle/vehicle-classes.ts";

const FRAME = 1 / FRAME_HZ;
/** Frames a pooled hit is compared over: past the impact and the first crush, where a leaked mass or crush face shows. */
const HIT_FRAMES = 90;
/** A hit at or over this closing speed (m/s) wrecks a car in the ejection matrix's calibration. */
const LETHAL_MPS = 40;
/** Sim seconds a strike is run, and the closing speed (m/s) and clear air (m) it starts with: close to the pair-squeeze rows' strike, shortened to the squeeze itself. */
const STRIKE_S = 2;
const STRIKE_MPS = 5.5;
const STRIKE_AIR_M = 0.25;
/** The derby pile compared: few cars and a short run, enough for wrecks to form (guarded), since the claim does not depend on the count. */
const PILE_CARS = 6;
const PILE_S = 4;
const PILE_MPS = 14;

/** What a run produced: one hash per frame over every car's state, the state itself at the end, and how many cars ended as wrecks (the pool served a crash). */
type Run = { frames: string[]; finals: number[][]; wrecks: number };

/** Every number the sims read or write on a car: pose, motion, each mass's place, velocity and rest-frame place, the engine, the crush faces. */
function stateOf(car: DeformableCar): number[] {
  const g = car.group;
  const d = car.deform;
  const out = [g.position.x, g.position.y, g.position.z, g.quaternion.x, g.quaternion.y, g.quaternion.z, g.quaternion.w];
  out.push(car.velocity.x, car.velocity.y, car.velocity.z, car.angular.x, car.angular.y, car.angular.z, car.speed);
  out.push(d.drivetrainHealth, d.engineTravel, d.drivetrainAlive ? 1 : 0, d.bidirectional ? 1 : 0, d.massActive ? 1 : 0);
  for (const m of d.masses) out.push(m.world.x, m.world.y, m.world.z, m.vel.x, m.vel.y, m.vel.z, m.local.x, m.local.y, m.local.z);
  for (const c of d.crush) out.push(c);
  return out;
}

function frameHash(cars: readonly DeformableCar[]): string {
  const hash = createHash("sha1");
  for (const car of cars) hash.update(Float64Array.from(stateOf(car)));
  return hash.digest("hex");
}

function finish(cars: readonly DeformableCar[], frames: string[], pooledRun: boolean): Run {
  const run = { frames, finals: cars.map(stateOf), wrecks: cars.filter((c) => c.deform.massActive).length };
  if (!pooledRun) for (const car of cars) car.dispose();
  return run;
}

/** The ejection matrix's hit (`collide`) on the pooled class cars, or on new ones. */
function hit(kind: "head-on" | "t-bone", striker: VehicleClassId, struck: VehicleClassId, mps: number, usePool: boolean): Run {
  const s = usePool ? dressAsClass(pooled(striker, 0), striker) : classCar(striker);
  const t = usePool ? dressAsClass(pooled(struck, 1), struck) : classCar(struck);
  if (kind === "head-on") {
    launch(s, -5, 0, Math.PI / 2, mps, 0);
    launch(t, 5, 0, -Math.PI / 2, -mps, 0);
  } else {
    launch(t, 0, 0, 0, 0, 0);
    launch(s, 6, 0, -Math.PI / 2, -mps, 0);
  }
  const w = makeWorld([s, t], false, false, null);
  const frames = [frameHash([s, t])];
  for (let f = 0; f < HIT_FRAMES; f++) {
    tickWorld(w);
    frames.push(frameHash([s, t]));
  }
  return finish([s, t], frames, usePool);
}

/** The pair-squeeze rows' strike: a parked car with a striker on each of `sides` (+1 its nose, -1 its tail, +2 its right flank), on pooled shape cars or new ones. */
function strike(sides: readonly (1 | -1 | 2)[], usePool: boolean): Run {
  const car = (slot: number): DeformableCar => (usePool ? pooledCar(slot) : makeCar("shape"));
  const middle = car(0);
  middle.spawnFacing(0, 0, 0, 0);
  const cars = [middle];
  for (const [i, side] of sides.entries()) {
    const striker = car(1 + i);
    const gap = middle.frame.half.z + striker.frame.half.z + STRIKE_AIR_M;
    if (side === 2) launch(striker, middle.frame.half.x + striker.frame.half.z + STRIKE_AIR_M, 0.08, -Math.PI / 2, -STRIKE_MPS, 0);
    else launch(striker, 0, side * gap, side > 0 ? Math.PI : 0, 0, -side * STRIKE_MPS);
    cars.push(striker);
  }
  const w = makeWorld(cars, false, false, null);
  const frames = [frameHash(cars)];
  for (let t = 0; t < STRIKE_S; t += FRAME) {
    tickWorld(w, FRAME);
    frames.push(frameHash(cars));
  }
  return finish(cars, frames, usePool);
}

/** A pile of `PILE_CARS` shape cars in the derby arena, stepped as the pair-squeeze pile row steps it. */
function pile(seed: number, usePool: boolean): Run {
  const cars: DeformableCar[] = [];
  for (let i = 0; i < PILE_CARS; i++) cars.push(usePool ? pooledCar(i) : makeCar("shape"));
  const { world } = arenaWorld(cars);
  placeDerby(cars, seed, PILE_MPS);
  const frames = [frameHash(cars)];
  for (let t = 0; t < PILE_S; ) {
    let fastest = 0;
    for (const c of cars) fastest = Math.max(fastest, c.speed);
    const step = physicsSlice(FRAME, Math.max(8, fastest));
    stepWorld(world, step);
    t += step;
    frames.push(frameHash(cars));
  }
  setGround(null);
  return finish(cars, frames, usePool);
}

/** The first frame whose hash differs, else the first car number and value that differs at the end, as text; "" when every frame and the end are bit for bit alike. */
function firstDifference(fresh: Run, pool: Run): string {
  const frame = fresh.frames.findIndex((f, i) => f !== pool.frames[i]);
  if (frame >= 0 || fresh.frames.length !== pool.frames.length) return `frame ${frame} of ${fresh.frames.length} differs`;
  for (const [c, state] of fresh.finals.entries()) {
    const k = state.findIndex((v, i) => !Object.is(v, pool.finals[c]![i]));
    if (k >= 0) return `car ${c} value ${k}: fresh ${state[k]}, pooled ${pool.finals[c]![k]}`;
  }
  return "";
}

describe("given the pooled cars of the crash rows (a class car per slot in the ejection matrix, a shape car per slot in the pair-squeeze rows)", () => {
  // mutation: sed -i 's/^    this.angular.set(0, 0, 0);$/    ;/' src/game/vehicle/car.ts  (a pooled car is placed again with the spin its last hit left it: the class-car row and the shape-car row go red; dropping `deform.reset()` instead never ends the run)
  it("when pooled class cars have served other hits and then play a hit, then every frame of it and the cars' end state equal new cars', bit for bit", () => {
    const served: [("head-on" | "t-bone"), VehicleClassId, VehicleClassId, number][] = [
      ["head-on", "sedan", "truck", 40],
      ["t-bone", "sedan", "hatch", 55],
      ["head-on", "sedan", "truck", 11],
    ];
    for (const [i, [kind, a, b, mps]] of served.entries()) {
      const pool = hit(kind, a, b, mps, true);
      if (mps >= LETHAL_MPS) expect(pool.wrecks, `hit ${i}: no car was wrecked`).toBeGreaterThan(0);
      expect(firstDifference(hit(kind, a, b, mps, false), pool), `${kind} ${a} into ${b} at ${mps} m/s, the pool already served ${i} hits`).toBe("");
    }
  });

  it("when pooled shape cars have served strikes and a derby pile and then play others, then every frame and the cars' end state equal new cars', bit for bit", () => {
    for (const [i, sides] of ([[1, -1], [1, 2]] as const).entries()) {
      const pool = strike(sides, true);
      expect(pool.wrecks, `strike ${sides}: no car was wrecked`).toBeGreaterThan(0);
      expect(firstDifference(strike(sides, false), pool), `strike ${sides}, the pool already served ${i} strikes`).toBe("");
    }
    for (const seed of [2, 4]) {
      const pool = pile(seed, true);
      expect(pool.wrecks, `pile seed ${seed}: no car was wrecked`).toBeGreaterThan(0);
      expect(firstDifference(pile(seed, false), pool), `pile seed ${seed}, the pool already served the strikes${seed === 4 ? " and seed 2" : ""}`).toBe("");
    }
  });
});
