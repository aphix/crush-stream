import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { setGround } from "../world/ground.ts";
import { makeWorld } from "../world/race-world.test-util.ts";
import { applyDrive, type DriveInput } from "../vehicle/car-drive.ts";
import { makeCar } from "../vehicle/ground-probe.test-util.ts";
import { QUIET_HZ, SLICES_PER_STEP } from "../kernel/constants.ts";
import { newWorld, settleStep, stepWorld } from "./world-step.ts";
import * as THREE from "three";
import { satCars } from "../contact/sat.ts";
import { COARSE, FINE, missedByLone, parkedPair } from "./world-step-lone.test-util.ts";
import { CONTACT_HOLD } from "../deform/deform-solve.ts";

/**
 * A lone car against the course's walls: Havana's alley wall (five 10 m panels across x = -40.25, approached from +x; `prop-wall.test.ts`), driven at it in the pacer's coarse steps,
 * a pair parked far off holding every step cut to fine slices, so only the car's own state decides between one slice and three.
 */
const NEAR = -40.25 + 0.22;
const FAR = -40.25 - 0.22;
const TOWARD = -Math.PI / 2;
const SPEED = 40;
/** The car's centre this far (m) from the wall's near face at the start (the ground drops 4 m to the wall's foot over the approach: the car comes down onto it). */
const START_GAP = 40;
/** A start on the flat at the wall's foot (level from x = -28): from `START_GAP` the car flies off the crest into the wall, and a cm of the lone run's lower flight picks the hit's outcome. */
const FLAT_GAP = 11;
/** Start gaps (m) on the flat at the wall's foot, tried in turn for a nose left resting on the face: how long the masses stay on it before the wreck sleeps follows every change to the contact, so the setup searches rather than pins one gap. */
const RESTING_GAPS = [11, 11.5, 10.5, 12, 10, 9.5, 9] as const;
/** The free steps with masses on the face a resting run needs: enough that the frame's walk is a mean over the rest, not one step's. */
const MIN_FREE_STEPS = 10;
/** A hit the sedan backs away from under reverse: slow enough that its drivetrain lives (m/s). */
const BACK_OFF_SPEED = 20;
/** How far (m) the nearest mass has moved off where the masses first rested on the face before the wreck is clear of it: well past the 2 cm skin within which the face counts a mass (`FACE_SKIN`). */
const OFF_FACE = 0.05;
/** The steps after the start that are not judged: the car comes down onto the ground and a landing asks for finer slices (`contactHz`, 9 steps measured). */
const SETTLE_STEPS = 15;
/** The steps from the first sliced one that must be sliced: the hit's (measured: the crush window closes about 25 steps after it). */
const HIT_STEPS = 20;
/** The wall's first step with the car's nose within a step's travel of it (the 2.3 m of its half length and the step's 0.5 m): the car is nearly on it. */
const NEAR_STEP_GAP = 2.3 + SPEED * COARSE + 0.5;

afterEach(() => setGround(null));

interface Run {
  /** Per step: the car's centre's gap to the near face at the step's start (m), whether it was a lone car, the slices the step ran, and at its end the sum of its masses' crush sets (m), its quiet time (s), whether its mass step is live, its masses resting on the face and its nearest mass's gap to the near face (m). */
  rows: { gap: number; lone: boolean; slices: number; set: number; quiet: number; live: boolean; face: number; near: number }[];
  past: number;
  x: number;
  alive: boolean;
}

function drive(lone: boolean, gap = START_GAP, speed = SPEED, throttle = 1): Run {
  const w = makeWorld();
  w.race.showLobby("havana");
  const car = makeCar("sedan");
  const parked = parkedPair();
  const cars = [car, ...parked];
  const world = newWorld(cars);
  world.collide = (c, i, h) => w.race.courseHit(c, i, h);
  world.fine = FINE;
  world.lone = lone;
  car.spawnFacing(NEAR + gap, 12, TOWARD, speed);
  car.velocity.set(-speed, 0, 0);
  const input: DriveInput = { throttle, steer: 0, brake: 0, ebrake: false, boost: false };
  const rows: Run["rows"] = [];
  let past = 0;
  for (let s = 0; s < 3 * QUIET_HZ; s++) {
    const gap = car.group.position.x - NEAR;
    applyDrive(car, input, COARSE);
    stepWorld(world, COARSE);
    settleStep(cars, COARSE, false);
    let near = Infinity;
    for (const m of car.deform.masses) {
      past = Math.max(past, FAR - m.world.x);
      near = Math.min(near, m.world.x - NEAR);
    }
    rows.push({ gap, lone: (world.loners & 1) === 1, slices: world.shape + 1, set: car.deform.masses.reduce((sum, m) => sum + m.crushSet, 0), quiet: car.deform.quietTime(), live: car.deform.live(), face: car.deform.faceContacts, near });
  }
  const out = { rows, past, x: car.group.position.x, alive: car.deform.drivetrainAlive };
  for (const c of cars) c.dispose();
  return out;
}

describe("given a sedan driven at 40 m/s at Havana's alley wall from 40 m, in coarse steps all cut to fine slices by a pair parked far off", () => {
  it("when lone cars run, then it is lone until its nose is within a step's travel of the wall, from there on every step takes all the slices, and it never gets a mass past the wall's far face", () => {
    const run = drive(true);
    const far = run.rows.slice(SETTLE_STEPS).filter((r) => r.gap > NEAR_STEP_GAP + 1);
    assert.ok(far.length > 20, `${far.length} steps well clear of the wall`);
    const bad = far.find((r) => !r.lone || r.slices !== SLICES_PER_STEP);
    assert.equal(bad, undefined, `a step well clear of the wall is a lone car's: ${JSON.stringify(bad)} of ${JSON.stringify(far.slice(0, 3))}`);
    const first = run.rows.findIndex((r, s) => s >= SETTLE_STEPS && !r.lone);
    assert.ok(first > SETTLE_STEPS, "the car left the lone steps");
    assert.ok(run.rows[first]!.gap > 0.5 && run.rows[first]!.gap <= NEAR_STEP_GAP + 1, `the first sliced step starts ${run.rows[first]!.gap.toFixed(2)} m from the wall`);
    assert.ok(run.rows.slice(first, first + HIT_STEPS).every((r) => !r.lone && r.slices === SLICES_PER_STEP), "the hit's steps take all the slices");
    assert.equal(run.past, 0, "no mass past the far face");
  });
});

describe("given a sedan driven at 40 m/s at Havana's alley wall from 11 m, on the flat at its foot, in coarse steps all cut to fine slices by a pair parked far off", () => {
  it("when lone cars run and when they do not, then the sedan ends the 3 s within 5 cm of the same place with the same drivetrain health", () => {
    const lone = drive(true, FLAT_GAP);
    const sliced = drive(false, FLAT_GAP);
    assert.ok(lone.rows.slice(0, 10).every((r) => r.lone), "it runs lone before the hit");
    assert.ok(sliced.rows.every((r) => !r.lone));
    assert.ok(Math.abs(lone.x - sliced.x) < 0.05, `${lone.x.toFixed(3)} against ${sliced.x.toFixed(3)} m`);
    assert.equal(lone.alive, sliced.alive);
  });
});

/** Cars `abeam` m apart, the far one on the side away from the wall: just outside the two hulls' clearance so the test calls them clear. */
const ABEAM = 2.6;
/** The grazing car's steer toward the wall (of full lock): a firm lean in, pressing the wall below a crash's 5.5 m/s (`WALL_CRUSH`), so no `nearHit` holds it and the wall's push is the course's alone. */
const WALLWARD_STEER = 0.4;
/** The grazing car's centre from the wall's face at the start (m): its body half (0.88) and a hand's breadth, so it rubs the wall from the first step. */
const AGAINST_WALL = 0.95;

interface Graze {
  /** Per step: whether the pair was clear (both lone) at its start. */
  clear: boolean[];
  missed: number;
  /** The deepest overlap of the pair at the start of any slice (m), and the first step a pair hit resolved. */
  depth: number;
  first: number;
  end: [number, number];
  /** The nearest the grazing car's centre came to the wall's face (m), and its fastest speed toward it (m/s). */
  nearest: number;
  wallward: number;
}

function graze(speed: number, lone: boolean): Graze {
  const w = makeWorld();
  w.race.showLobby("havana");
  const a = makeCar("sedan");
  const b = makeCar("sedan");
  const cars = [a, b, ...parkedPair()];
  const world = newWorld(cars);
  world.collide = (c, i, h) => w.race.courseHit(c, i, h);
  world.fine = FINE;
  world.lone = lone;
  // Nose along +z with the wall to the left (-x): steering toward it leans the grazing car in.
  a.spawnFacing(NEAR + AGAINST_WALL, -8, 0, speed);
  b.spawnFacing(NEAR + AGAINST_WALL + ABEAM, -8, 0, speed);
  const n = new THREE.Vector3();
  const p = new THREE.Vector3();
  const out: Graze = { clear: [], missed: 0, depth: 0, first: -1, end: [0, 0], nearest: Infinity, wallward: 0 };
  let step = 0;
  world.pairHit = (i, j) => {
    if (i + j === 1 && out.first < 0) out.first = step;
  };
  world.beforeSlice = () => {
    out.depth = Math.max(out.depth, satCars(a, b, n, p, 0) ?? 0);
    return false;
  };
  const input: DriveInput = { throttle: 0.4, steer: 0, brake: 0, ebrake: false, boost: false };
  for (; step < 2 * QUIET_HZ; step++) {
    applyDrive(a, { ...input, steer: -WALLWARD_STEER }, COARSE);
    applyDrive(b, input, COARSE);
    stepWorld(world, COARSE);
    settleStep(cars, COARSE, false);
    out.clear.push((world.loners & 0b11) === 0b11);
    out.nearest = Math.min(out.nearest, a.group.position.x - NEAR);
    out.wallward = Math.max(out.wallward, -a.velocity.x);
    out.missed += missedByLone(world);
  }
  out.end = [a.group.position.x, b.group.position.x];
  for (const c of cars) c.dispose();
  return out;
}

describe("given a sedan leaning into Havana's alley wall below a crash's speed, with another 2.6 m abeam on the far side, in coarse steps cut by a pair parked far off", () => {
  for (const speed of [20, 30]) {
    it(`when they drive on at ${speed} m/s, then the pair is lone while the wall's push can not reach the other car, no overlap of the pair is missed, and the first contact and the end poses agree with the sliced run's`, () => {
      const on = graze(speed, true);
      const off = graze(speed, false);
      assert.equal(on.missed, 0, "pairs with a lone car that overlap at a step's end");
      assert.equal(on.first, off.first, "first pair contact");
      assert.ok(on.depth <= off.depth + 0.02, `deepest overlap ${on.depth.toFixed(3)} m against ${off.depth.toFixed(3)} m`);
      assert.ok(Math.abs(on.end[1] - off.end[1]) < 0.05, `the neighbour ends ${on.end[1].toFixed(3)} m against ${off.end[1].toFixed(3)} m`);
      assert.ok(on.clear.some(Boolean), "the pair was clear in some step");
      assert.ok(on.nearest < 1 && off.nearest < 1, `the car pressed on the wall (its centre ${on.nearest.toFixed(2)} / ${off.nearest.toFixed(2)} m from the face, a body half 0.9 m wide)`);
      assert.ok(on.wallward > 0.2 && on.wallward < 5.5, `its fastest speed toward the wall (read after the wall's push) was ${on.wallward.toFixed(2)} m/s`);
    });
  }
});

describe("given a sedan driven at 40 m/s into Havana's alley wall from 40 m, its nose left resting on the wall's face", () => {
  it("when it runs lone and when it runs sliced, then no crush set grows once the contact hold after its last loading contact is over: the set it keeps is the hit's", () => {
    const grew: string[] = [];
    for (const lone of [true, false]) {
      const { rows } = drive(lone);
      let last = -1;
      for (let s = 0; s < rows.length; s++) if (rows[s]!.quiet <= CONTACT_HOLD) last = s;
      assert.ok(last > 0 && last + 1 < rows.length, `the last step in a loading contact's hold: ${last} of ${rows.length}`);
      const kept = rows[last + 1]!.set;
      const grown = rows.at(-1)!.set - kept;
      if (grown > 0) grew.push(`${lone ? "lone" : "sliced"}: ${grown.toFixed(3)} m over ${kept.toFixed(3)} m after step ${last + 1}`);
    }
    assert.deepEqual(grew, [], "the sets grew");
  });
});

/** The frame's move (m, + away from the wall) over each step whose shape step runs free (past the contact hold, still live) with masses on the face. */
function freeMoves(rows: Run["rows"]): number[] {
  const moves: number[] = [];
  for (let s = 0; s + 1 < rows.length; s++) {
    const r = rows[s]!;
    if (r.live && r.quiet > CONTACT_HOLD && r.face > 0) moves.push(rows[s + 1]!.gap - r.gap);
  }
  return moves;
}

/** The first of `RESTING_GAPS` from which both the lone and the sliced run rest on the face for more than `MIN_FREE_STEPS` free steps, and those runs' free moves. */
function restingOnFace(): { gap: number; runs: { lone: boolean; moves: number[] }[] } {
  for (const gap of RESTING_GAPS) {
    const runs = [true, false].map((lone) => ({ lone, moves: freeMoves(drive(lone, gap).rows) }));
    if (runs.every((r) => r.moves.length > MIN_FREE_STEPS)) return { gap, runs };
  }
  assert.fail(`no start gap of ${RESTING_GAPS.join(", ")} m leaves the nose resting on the face for more than ${MIN_FREE_STEPS} free steps, lone and sliced`);
}

describe("given a sedan driven at 40 m/s into Havana's alley wall from the flat at its foot, its nose left resting on the wall's face", () => {
  it("when it runs lone and when it runs sliced, then over the steps its shape step runs free (past the contact hold, still live) with masses on the face, the frame does not walk toward the wall", (t) => {
    const { gap, runs } = restingOnFace();
    const walks: string[] = [];
    for (const { lone, moves } of runs) {
      let moved = 0;
      for (const m of moves) moved += m;
      const perStep = (moved / moves.length) * 1000;
      t.diagnostic(`from ${gap} m, ${lone ? "lone" : "sliced"}: ${perStep.toFixed(2)} mm a step away from the wall over ${moves.length} free steps`);
      if (perStep < 0) walks.push(`${lone ? "lone" : "sliced"}: ${(-perStep).toFixed(2)} mm a step toward the wall over ${moves.length} steps from ${gap} m`);
    }
    assert.deepEqual(walks, [], "the frame walked toward the face it rests on");
  });
});

describe("given a sedan driven at 20 m/s into Havana's alley wall from 11 m with reverse held, so it backs off the wall's face after the hit", () => {
  it("when it runs lone and when it runs sliced, then its masses rest on the face after the hit, and no later step that ends with them clear of where they rested counts any on the face", (t) => {
    const counted: string[] = [];
    for (const lone of [true, false]) {
      const { rows } = drive(lone, FLAT_GAP, BACK_OFF_SPEED, -1);
      const first = rows.findIndex((r) => r.face > 0);
      assert.ok(first >= 0, `${lone ? "lone" : "sliced"}: no step with masses on the face`);
      const rest = rows[first]!.near;
      const on = rows.filter((r) => r.face > 0).length;
      const off = rows.slice(first).filter((r) => r.near > rest + OFF_FACE);
      const stale = off.filter((r) => r.face > 0).length;
      t.diagnostic(`${lone ? "lone" : "sliced"}: ${on} steps with masses on the face, ${off.length} clear of it, ${stale} of those counting masses on it`);
      assert.ok(on > 0 && off.length > 0, `${lone ? "lone" : "sliced"}: ${on} steps on the face, ${off.length} clear of it`);
      if (stale > 0) counted.push(`${lone ? "lone" : "sliced"}: ${stale} of ${off.length} steps clear of the face`);
    }
    assert.deepEqual(counted, [], "steps clear of the face that count masses on it");
  });
});
