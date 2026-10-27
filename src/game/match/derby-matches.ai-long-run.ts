import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { DerbyMatch, snapshotAiCar } from "./derby.ts";
import { DERBY_RADIUS } from "../scenes/derby-arena.ts";
import { arenaWorld, placeDerby } from "../scenes/derby-arena.test-util.ts";
import { setGround } from "../world/ground.ts";
import { DERBY_FREE_PROPS } from "../scenes/derby-ground.ts";
import { applyAiDrive } from "../ai/input-fade.ts";
import { fleetStyle, layoutDerby, MAX_CARS } from "../scenes/fleet.ts";
import { DeformableCar } from "../vehicle/car.ts";
import { mayRecoverFlipped, recoverInPlace } from "../vehicle/car-drive.ts";
import { physicsSlice } from "../contact/sat.ts";
import { stepWorld } from "../engine/world-step.ts";
import { CAR_STYLE_IDS, CAR_STYLES } from "../vehicle/car-variants.ts";
import { carFrame } from "../vehicle/car-rig.ts";
import { armKill, carClass, DEFAULT_REALISM } from "../vehicle/vehicle-classes.ts";
import { FRAME_HZ } from "../kernel/constants.ts";

/**
 * Full-sanity run, not the per-commit suite (`npm run test:ai-long-run`): AI derby matches watched for anything going wrong. Each check
 * plays one fixed match (a fixed seed or the owner's capture), so it reads one outcome every run; the AI's choices and the derby's rules
 * are judged staged where they are made (owner, 2026-10-26). What pins each named failure in the per-commit suite: accumulated wrecking
 * (a re-armed hit adds its EBS²) is `vehicle/barrier.test.ts` (engine killed on the third 33 km/h hit) and `deform/crash-physics.test.ts`
 * (`rearmHit`); no death before 8 s is `ai/derby-ai.ai-long-run.ts`; elimination, count-outs and the time limit are `match/derby.test.ts`;
 * nose to nose banned and the wedge breaker are `match/derby.test.ts`; a settled wreck that zips when hit again is `contact/pile-push.test.ts`.
 * The elimination rate over seeds 1-20 and the deaths over five 90 s matches were pooled statistics of the kill tuning, now pinned by those rules.
 */

/** Which face of `car` the world point sits on. */
function face(car: DeformableCar, p: THREE.Vector3): "front" | "rear" | "side" {
  const dx = p.x - car.group.position.x;
  const dz = p.z - car.group.position.z;
  const along = (dx * car.fwdFlat.x + dz * car.fwdFlat.z) / car.frame.half.z;
  const across = (dx * car.fwdFlat.z - dz * car.fwdFlat.x) / car.frame.half.x;
  if (Math.abs(along) * 1.15 < Math.abs(across)) return "side";
  return along > 0 ? "front" : "rear";
}

type DerbyRun = { hits: number; noseToNose: number; worstWedge: number; t: number; state: string; deaths: number[]; zips: string[]; pops: string[] };

/** Mass centroid (x, z): with the masses live it is where the car actually is. */
function centroid(car: DeformableCar): { x: number; z: number } {
  let x = 0;
  let z = 0;
  let m = 0;
  for (const p of car.deform.masses) {
    x += p.world.x * p.mass;
    z += p.world.z * p.mass;
    m += p.mass;
  }
  return { x: x / m, z: z / m };
}

/**
 * Crush knobs a derby runs at. `rear` is chassisRear's maxCrush; `realism` arms each car's class kill
 * travel and wreck energy as the engine's derby does (`armKill(…, "derby")`), null keeps the deformer's sourced 0.15 m.
 */
type Knobs = { squash: number; rear: number; realism: number | null };
/** Main's knobs before the crush calibration. */
const ARCADE: Knobs = { squash: 0.4, rear: 0.45, realism: null };
/** CrushCalibration's realistic defaults (lane/calib-defaults) at Handling's default realism. */
const REALISTIC: Knobs = { squash: 0.32, rear: 0.38, realism: DEFAULT_REALISM };

/** Builds and runs cars with every style frame's chassisRear maxCrush at `knobs.rear` (cages copy their spec at construction). */
function atKnobs(knobs: Knobs, build: () => DeformableCar[], seconds: number, start?: number): DerbyRun {
  const rears = CAR_STYLE_IDS.map((id) => carFrame(CAR_STYLES[id]).rig.cages.find((c) => c.name === "chassisRear")!);
  const rests = rears.map((c) => c.maxCrush);
  for (const c of rears) c.maxCrush = knobs.rear;
  try {
    return runDerby(build(), seconds, knobs, start);
  } finally {
    for (const [k, c] of rears.entries()) c.maxCrush = rests[k]!;
    setGround(null);
  }
}

/** Six AI cars in the bowl at the arcade knobs, laid out from `seed`. */
function sixCarDerby(seconds: number, seed: number): DerbyRun {
  return atKnobs(ARCADE, () => {
    const scene = new THREE.Scene();
    const cars = Array.from({ length: 6 }, (_, i) => new DeformableCar({ body: 0xc5c8ce, accent: 0x9aa0a8, name: `c${i}` }, scene));
    placeDerby(cars, seed);
    return cars;
  }, seconds);
}

/** The owner's 9-car derby capture (main 75deb20, fleet styles, 12 m/s): x, z, yaw. Its wrecks zipped along the rim. Its cars ran tangent on the old bowl's spawn ring (11.2 m); `ownerDerby` replays them on the arena's. */
const OWNER_DERBY: readonly (readonly [number, number, number])[] = [
  [9.5, -5.931, 3.6997],
  [3.465, -10.65, 4.3979],
  [-4.192, -10.386, 5.096],
  [-9.887, -5.262, 5.7941],
  [-10.956, 2.325, 6.4923],
  [-6.899, 8.823, 7.1904],
  [0.387, 11.193, 7.8885],
  [7.491, 8.326, 8.5866],
  [11.09, 1.563, 9.2848],
];

/**
 * A capture of moving cars, so its match starts at green (no start lights). Each of the capture's cars stands on the nearest slot the
 * game's own layout gives a full field (`layoutDerby`, so no car starts facing a prop) to its captured bearing, heading as it did.
 */
function ownerDerby(seconds: number, knobs = ARCADE, spawnMps = OWNER_SPAWN_MPS): DerbyRun {
  const slots = layoutDerby(MAX_CARS, DERBY_RADIUS, () => 0, DERBY_FREE_PROPS);
  return atKnobs(knobs, () => {
    const scene = new THREE.Scene();
    return OWNER_DERBY.map(([x, z, yaw], i) => {
      const c = new DeformableCar({ body: 0xffffff, accent: 0x444444, name: `o${i}` }, scene, null, fleetStyle(i));
      const want = Math.atan2(x, z);
      let best = slots[0]!;
      for (const s of slots) {
        if (Math.abs(Math.sin((Math.atan2(s.x, s.z) - want) / 2)) < Math.abs(Math.sin((Math.atan2(best.x, best.z) - want) / 2))) best = s;
      }
      c.spawnFacing(best.x, best.z, yaw, spawnMps);
      return c;
    });
  }, seconds, 0);
}

/** The capture's spawn speed (m/s), and the one beside it where the open wall-shove pop shows (spawn 11.80 m/s, o6 at 4.78-4.85 s). */
const OWNER_SPAWN_MPS = 12;
const POP_SPAWN_MPS = 11.8;

/**
 * AI cars in the bowl in the engine's contact order, until `seconds` after the green light or the match ends. A
 * zip is a slice where a live wreck's mass centroid moves more than 3× its speed allows (+5 cm); the slice its
 * masses go live is skipped (the group origin sits 0.23 m behind the mass centroid). `start`: seconds of start
 * lights (default the match's).
 */
function runDerby(cars: DeformableCar[], seconds: number, knobs: Knobs, start?: number): DerbyRun {
    const n = cars.length;
    const names = cars.map((c) => c.paint.name);
    const match = new DerbyMatch();
    match.begin(cars.map((_, i) => ({ id: i, name: names[i]! })), { start });
    const { world: w } = arenaWorld(cars);
    for (const c of cars) {
      c.deform.squash = knobs.squash;
      c.deform.buckle = 0.45;
      c.deform.setMode("shape");
      if (knobs.realism !== null) armKill(c.deform, carClass(c), knobs.realism, "derby");
    }
    const wedged = new Array<number>(n).fill(0);
    let worstWedge = 0;
    let hits = 0;
    let noseToNose = 0;
    let t = match.time;
    let state = "running";
    const deaths: number[] = [];
    const zips: string[] = [];
    const pops: string[] = [];
    while (t < seconds && state === "running") {
      const before = cars.map((c) => (c.deform.massActive ? centroid(c) : null));
      const group0 = cars.map((c) => (c.crashed && c.deform.massActive ? { x: c.group.position.x, z: c.group.position.z } : null));
      const speed0 = cars.map((c) => Math.hypot(c.velocity.x, c.velocity.z));
      const shove = new Array<number>(n).fill(0);
      let vmax = 8;
      for (const c of cars) vmax = Math.max(vmax, c.speed);
      const h = physicsSlice(1 / FRAME_HZ, vmax);
      const snaps = match.snapshots(n);
      for (const [i, c] of cars.entries()) snapshotAiCar(snaps[i]!, i, c, c.deform.drivetrainAlive);
      for (const [i, c] of cars.entries()) applyAiDrive(c, match.think(snaps[i]!, snaps, h), h);
      // The AI presses R as the engine's derby does (`recoverDue`), so a flipped car that still runs is back in the match.
      for (const [i, c] of cars.entries()) if (match.recoverDue(i, c, h)) recoverInPlace(c, mayRecoverFlipped);
      w.pairHit = (a, b, pair) => {
        const ca = cars[a]!;
        const cb = cars[b]!;
        // The hull push shoves a car out of a rammer's way at up to the rammer's speed.
        shove[a] = Math.max(shove[a]!, speed0[b]!);
        shove[b] = Math.max(shove[b]!, speed0[a]!);
        const aInto = -(ca.velocity.x * pair.normal.x + ca.velocity.z * pair.normal.z);
        const bInto = cb.velocity.x * pair.normal.x + cb.velocity.z * pair.normal.z;
        if (!match.noteHit(a, b, aInto, bInto, pair.impulse)) return;
        hits++;
        if (face(ca, pair.contact) === "front" && face(cb, pair.contact) === "front") noseToNose++;
      };
      stepWorld(w, h);
      for (const c of cars) if (c.deform.massActive && !c.deform.drivetrainAlive) c.deform.cutDrive(h);
      state = match.step(h, cars.map((c, i) => ({ id: i, name: names[i]!, alive: c.deform.drivetrainAlive, x: c.group.position.x, z: c.group.position.z })));
      const dead = cars.filter((c) => !c.deform.drivetrainAlive).length;
      while (deaths.length < dead) deaths.push(t);
      for (const [i, c] of cars.entries()) {
        const stuck = c.deform.drivetrainAlive && Math.abs(c.drive.throttle) > 0.3 && Math.hypot(c.velocity.x, c.velocity.z) < 1;
        wedged[i] = stuck ? wedged[i]! + h : 0;
        worstWedge = Math.max(worstWedge, wedged[i]!);
      }
      for (const [i, c] of cars.entries()) {
        const a = before[i];
        if (!a || !c.deform.massActive) continue;
        const b = centroid(c);
        const moved = Math.hypot(b.x - a.x, b.z - a.z);
        const v = Math.max(speed0[i]!, Math.hypot(c.velocity.x, c.velocity.z), shove[i]!);
        if (moved > 3 * v * h + 0.05) zips.push(`t=${t.toFixed(2)} ${names[i]} moved ${moved.toFixed(2)} m in ${(h * 1000).toFixed(1)} ms at ${v.toFixed(1)} m/s`);
        const g = group0[i];
        const jump = g ? Math.hypot(c.group.position.x - g.x, c.group.position.z - g.z) : 0;
        if (g && jump > 3 * v * h + 0.02) pops.push(`t=${t.toFixed(2)} ${names[i]} group ${jump.toFixed(3)} m in ${(h * 1000).toFixed(1)} ms at ${v.toFixed(1)} m/s quiet ${c.deform.quietTime().toFixed(2)}`);
      }
      t += h;
    }
    return { hits, noseToNose, worstWedge, t, state, deaths, zips, pops };
}

/** The seed of the arcade 20 s derby. */
const HIT_SEED = 7;

describe("given derby matches between AI cars", () => {
  const owner = ownerDerby(15);
  const ownerReal = ownerDerby(15, REALISTIC);

  describe(`given six AI cars in the arena at the arcade crush knobs (seed ${HIT_SEED})`, () => {
    it("when 20 s of derby are played, then the cars keep hitting (at least 15 scored hits), under a quarter of the hits are nose to nose and nobody sits wedged on the throttle for 3 s", () => {
      const { hits, noseToNose, worstWedge } = sixCarDerby(20, HIT_SEED);
      assert.ok(hits >= 15, `only ${hits} scored hits in 20 s`);
      assert.ok(noseToNose / hits < 0.25, `${noseToNose}/${hits} hits were nose to nose`);
      assert.ok(worstWedge < 3, `a car sat on the throttle without moving for ${worstWedge.toFixed(2)} s`);
    });
  });
  describe("given the owner's 9-car derby run for 15 s", () => {
    it("when settled wrecks are hit again in the 9-car derby, at crush squash 0.4 and rear 0.45 and again at the realistic 0.32 and 0.38, then no wreck ever moves faster than its own parts allow (it never jumps)", () => {
      assert.equal(owner.zips.length, 0, `0.4/0.45: ${owner.zips.length} zips: ${owner.zips.slice(0, 4).join("; ")}`);
      assert.equal(ownerReal.zips.length, 0, `0.32/0.38: ${ownerReal.zips.length} zips: ${ownerReal.zips.slice(0, 4).join("; ")}`);
    });

    // Was 19 pops in 15 s (0.10–0.24 m): the first contact on a planted wreck re-anchored the group on
    // the cell's rest inside one dt = 0 syncPose. Open: a wreck re-touched while its frame's lean eases is moved by the crush-mass path's
    // position corrections (`clampLocal`, `stepStructure`): 0.033 m in 8.8 ms at 0.4 m/s on the owner's capture, 0.051 m on spawn 12.15
    // with the planted hubs' frame charge. The wreck split goes in Stage 4 (a wreck is a rigid body on the one solve, no position
    // corrections); that stage turns this back on as it stands.
    // Same family in the browser derby (10 cars, 20 s, every step of every car against 3·v·h + 2 cm, the smoke scan): a wreck at 0.04-1 m/s
    // with no pair hit and no car within 3.3 m moves its masses 2-5.6 cm a step for 1-7 steps (seed 1: 4.3, 4.7, 4.9 cm at t = 7.83 s,
    // mass velocity 0.17-0.52 m/s; seed 2: 5.6 cm at 11.75 s): seeds 1/2/3/default give 3/4/1/7 events, max 4.9/5.6/2.1/2.7 cm on the lane
    // against 0/0/1/6, max 0/0/5.0/5.4 cm on da39401. Closes with the above.
    it(`when a car crashes, then its body never moves more than 3 times its speed times the slice length plus 2 cm in one slice, from the spawn speed ${POP_SPAWN_MPS} m/s where the pop shows`, { todo: "after the plan (still open after Stage 4 item 6, the wreck split): a wreck at rest against the ring wall takes the wall's drawn-body shove (`wallBounce`) once per wall piece it meets in a slice: spawn 11.80 m/s, o6 at 4.78-4.85 s, three or four 12-13 mm shoves in one 8.8 ms slice (group 0.03-0.047 m at 0.0 m/s). Limiting the slice's total to one reach moved the pops to spawn 11.65 (o6 0.032-0.047 m at 0.3 m/s, mid-contact), cleared the stucco second-hit sink row, and reshuffled derby-ai (seeds 5-7 zipped, a spin) and engine-replay seed 1; closes with the masses carried as a crush layer of the rigid body" }, () => {
      const run = ownerDerby(15, ARCADE, POP_SPAWN_MPS);
      assert.equal(run.pops.length, 0, `${run.pops.length} pops: ${run.pops.slice(0, 4).join("; ")}`);
    });
  });
});
