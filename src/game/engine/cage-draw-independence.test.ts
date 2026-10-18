import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { setGround } from "../world/ground.ts";
import { blankPoint, Track } from "../world/track.ts";
import city from "../world/tracks/city.json" with { type: "json" };
import { FRAME_HZ } from "../kernel/constants.ts";
import { COUNTDOWN, GRID_TIME } from "../match/session.ts";
import { makeWorld, type World } from "../world/race-world.test-util.ts";
import { EPICENTER, loadEpicenter } from "../deform/epicenter.ts";
import { EPICENTER_AT_LOAD } from "../deform/epicenter.test-util.ts";
import { recordField } from "./replay-fidelity.test-util.ts";

/**
 * The car's cage is a function of the sim's state alone, scheduled by the sim alone (docs/HIGHLIGHTS.md): drawing a car (`updateSkin`,
 * once per rendered frame in the engine, and only for the cars the camera sees) must not change what any car does, however often or
 * rarely it draws. A staged head-on is run twice; the second also draws every car before every step. Every car's pose, velocity and
 * crush, and the fields of its cage, must be the same numbers at every step, to the bit.
 */

/** The city course with the head-on's two cars (2 and 3) and the player's and car 1: no field around them to crash into. */
const FIELD = { trackId: "city", laps: 1, aiCount: 3, noReset: false, aggression: 1 };
const SEED = 5;
/** Cars 2 and 3 meet head-on 8 m apart on the city road at these speeds (m/s): a hard hit, so the cars crush and the cages refit. */
const HEAD_ON_MPS = { a: 30, b: 10 };
/** Race time the hit is staged at: the clock runs from minus the grid and the countdown, where the cars are held. */
const STAGED_AT_S = 1;
const START_S = GRID_TIME + COUNTDOWN;
/** Race time the run goes on for after the hit is staged: the impact, the crush settling and the cage refits. */
const AFTER_STAGED_S = 3;
/** Numbers per car: x, y, z, vx, vy, vz, total crush, wreck flag, the cage's refits and a sum of its top field; both doors' swing and spin; then hinge value and flags of up to `PARTS_MAX` parts (not `open`: that is the drawn shell, which only a frame sets). */
const PARTS_MAX = 20;
const STATE = 14 + 2 * PARTS_MAX;
/** The angle (rad) the door-ajar stage opens car 3's doors to. */
const DOOR_AJAR_RAD = 0.9;

/** Cars 2 and 3 put head-on 8 m apart on the city road, intact, at `HEAD_ON_MPS`. */
function stageHeadOn(w: World): void {
  const track = new Track(city);
  const pt = blankPoint();
  track.pointAt(150, pt);
  w.cars[2]!.spawnFacing(pt.x, pt.z, Math.atan2(pt.tx, pt.tz), HEAD_ON_MPS.a);
  track.pointAt(158, pt);
  w.cars[3]!.spawnFacing(pt.x, pt.z, Math.atan2(pt.tx, pt.tz) + Math.PI, HEAD_ON_MPS.b);
}

/** The first step and number at which two runs of a race differ (step -1: none). */
function firstDifference(a: Float64Array[], b: Float64Array[]): { step: number; at: number } {
  for (let s = 0; s < a.length; s++) for (let k = 0; k < a[s]!.length; k++) if (a[s]![k] !== b[s]![k]) return { step: s, at: k };
  return { step: -1, at: -1 };
}

/** Cars 2 and 3 abeam on the city road, 2.2 m apart, car 3's doors both open `DOOR_AJAR_RAD`: car 2 comes up alongside and meets an open door. */
function stageDoorAjar(w: World): void {
  const track = new Track(city);
  const pt = blankPoint();
  track.pointAt(150, pt);
  const heading = Math.atan2(pt.tx, pt.tz);
  w.cars[2]!.spawnFacing(pt.x, pt.z, heading, 14);
  w.cars[3]!.spawnFacing(pt.x + pt.tz * 2.2, pt.z - pt.tx * 2.2, heading, 8);
  for (const side of [-1, 1]) w.cars[3]!.doorHinge(side).theta = DOOR_AJAR_RAD;
}

/** Every car's state at the start of every recorder step of a race, with `draw` run on every car ahead of it; `skip` is `EPICENTER.presentSkip`. */
function run(draw: boolean, opts: { skip?: boolean; stage?: "head-on" | "door ajar" } = {}): Float64Array[] {
  loadEpicenter(EPICENTER_AT_LOAD);
  EPICENTER.presentSkip = opts.skip ? 1 : 0;
  const w = makeWorld();
  w.race.enter();
  try {
    const trace: Float64Array[] = [];
    let staged = -1;
    recordField(w, {
      options: FIELD,
      seed: SEED,
      before: (n) => {
        if (n === 0) {
          const rec = w.race.recorder;
          const inner = rec.startStep.bind(rec);
          rec.startStep = (cars) => {
            if (draw) for (const car of cars) car.updateSkin();
            const out = new Float64Array(cars.length * STATE);
            for (let i = 0; i < cars.length; i++) {
              const c = cars[i]!;
              const o = i * STATE;
              out[o] = c.group.position.x;
              out[o + 1] = c.group.position.y;
              out[o + 2] = c.group.position.z;
              out[o + 3] = c.velocity.x;
              out[o + 4] = c.velocity.y;
              out[o + 5] = c.velocity.z;
              for (const m of c.deform.masses) out[o + 6] += m.local.distanceTo(m.rest);
              out[o + 7] = c.deform.massActive ? 1 : 0;
              const cage = c["cageRig"]?.cage;
              if (cage !== undefined) {
                out[o + 8] = cage.refits;
                for (const h of cage.fields.top) if (h === h) out[o + 9] += h;
              }
              // The doors' swing and what each attached part carries: where a skipped re-pose could leak into what the contacts read.
              for (const [d, side] of [-1, 1].entries()) {
                const door = c.doorHinge(side);
                out[o + 10 + 2 * d] = door.theta;
                out[o + 11 + 2 * d] = door.omega;
              }
              const parts = c["parts"] as readonly { hingeT: number; detached: boolean; folding: boolean }[];
              for (let p = 0; p < parts.length; p++) {
                out[o + 14 + 2 * p] = parts[p]!.hingeT;
                out[o + 15 + 2 * p] = (parts[p]!.detached ? 1 : 0) + (parts[p]!.folding ? 2 : 0);
              }
            }
            trace.push(out);
            inner(cars);
          };
        }
        if (staged < 0 && w.race.time >= STAGED_AT_S) {
          if (opts.stage === "door ajar") stageDoorAjar(w);
          else stageHeadOn(w);
          staged = w.race.time;
        }
      },
      done: () => staged >= 0 && w.race.time - staged >= AFTER_STAGED_S,
      maxFrames: (START_S + STAGED_AT_S + AFTER_STAGED_S + 1) * FRAME_HZ,
    });
    return trace;
  } finally {
    w.race.exit();
    setGround(null);
    loadEpicenter(EPICENTER_AT_LOAD);
  }
}

describe("given a staged crash run twice, the second drawing every car before every step", () => {
  for (const stage of ["head-on", "door ajar"] as const) {
    it(`when the ${stage} is done, then every car's pose, velocity, crush, cage fields, door swing and every part's hinge value and state are the same numbers at every step`, () => {
      const plain = run(false, { stage });
      const drawn = run(true, { stage });
      assert.equal(drawn.length, plain.length, "the two races ran a different number of steps");
      let wrecked = 0;
      let refits = 0;
      let doorMoved = 0;
      for (const row of plain) for (let o = 0; o < row.length; o += STATE) {
        wrecked = Math.max(wrecked, row[o + 7]!);
        refits = Math.max(refits, row[o + 8]!);
        for (let d = 0; d < 2; d++) doorMoved = Math.max(doorMoved, Math.abs(row[o + 10 + 2 * d]! - DOOR_AJAR_RAD));
      }
      assert.ok(wrecked === 1 && refits >= 2, `the race crushed no car (${wrecked}) or fitted no cage twice (${refits}): the comparison proves nothing`);
      if (stage === "door ajar") assert.ok(doorMoved > 0.01, `no open door was struck or swung (${doorMoved} rad): the comparison proves nothing about part contacts`);
      const first = firstDifference(plain, drawn);
      assert.equal(first.step, -1, `a car differs at step ${first.step}, car ${Math.floor(first.at / STATE)}, number ${first.at % STATE}: ${plain[first.step]?.[first.at]} against ${drawn[first.step]?.[first.at]}`);
    });
  }
});

describe("given a staged crash drawn every frame with `presentSkip` off and then on", () => {
  for (const stage of ["head-on", "door ajar"] as const) {
    it(`when the ${stage} is done, then every car's pose, velocity, crush, cage fields, door swing and part state are the same numbers at every step`, () => {
      const every = run(true, { skip: false, stage });
      const skipped = run(true, { skip: true, stage });
      assert.equal(skipped.length, every.length, "the two races ran a different number of steps");
      const first = firstDifference(every, skipped);
      let doorMoved = 0;
      for (const row of every) for (let o = 0; o < row.length; o += STATE) for (let d = 0; d < 2; d++) doorMoved = Math.max(doorMoved, Math.abs(row[o + 10 + 2 * d]! - DOOR_AJAR_RAD));
      if (stage === "door ajar") assert.ok(doorMoved > 0.01, `no open door was struck or swung (${doorMoved} rad): the comparison proves nothing about part contacts`);
      assert.equal(first.step, -1, `a car differs at step ${first.step}, car ${Math.floor(first.at / STATE)}, number ${first.at % STATE}: ${every[first.step]?.[first.at]} against ${skipped[first.step]?.[first.at]}`);
    });
  }
});
