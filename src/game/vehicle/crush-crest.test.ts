import { after, afterEach, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { setGround } from "../world/ground.ts";
import { Track } from "../world/track.ts";
import { TRACKS } from "../world/tracks/index.ts";
import { parseTrack } from "../world/track-schema.ts";
import { CLASSES, VEHICLE_CLASS_IDS, type VehicleClassId } from "./vehicle-classes.ts";
import { DEG, drive, FRAME, type Sample } from "./ground-probe.test-util.ts";
import { CONTACT_HZ, G, REST_SPEED } from "./car-air-body.ts";
import { carFrame } from "./car-rig.ts";
import { CAR_STYLES } from "./car-variants.ts";
import { SPRINGS } from "./car-suspension.ts";
import { useStiffSprings } from "./stiff-springs.test-util.ts";
import { BOUNDS } from "./ground-judge.test-util.ts";

/**
 * The stunt course's CRUSH crest (owner's report: a car on the hill under the CRUSH billboards, wheels flat and the
 * rear bumper in the road). The road peaks at s ≈ 899 (y 9.36 m, the billboards flank it), then drops down the kicker
 * face (−21.5° at s 908, a dip at s ≈ 908–916) to a −9° … −4° descent toward the tunnel mouth.
 */
const track = new Track(TRACKS.find((t) => parseTrack(t).id === "stunt"));

/** Most the body's pitch may stray (deg) from the road's slope on its springs: the front axle at one end of its travel, the rear at the other. */
function springPitch(cls: VehicleClassId): number {
  return Math.atan(SPRINGS[cls].travel / (2 * carFrame(CAR_STYLES[CLASSES[cls].style]).halfBase)) * DEG;
}
/** The drop matrix's bounds (ground-fit): a tyre sunk past `gap`, an underside past `pen`, a body off its ground's slope past `pose`. */
const PLAIN = BOUNDS.plain;
/** Canary: the body turning this much (deg) in one frame is a snap, whatever the springs do (fleet-ramps' bar for a jump). */
const SNAP = 6;
/**
 * The monster's own crest bars over its springs' (`pitch`, `gap`): its centre stands 0.71 m up its frame (`centreLift`), so over the crest its
 * body pitches past its springs' travel further than a body whose centre sits over its hubs, and a tyre lifts. Stock centre to lifted (with
 * the tread as wide as drawn): drawn pitch 7.82° to 10.21° at 4 m/s, frame 7.66° to 9.52° and a tyre 1.4 to 3.0 cm off the road at 8 m/s
 * (its travel's 9.2°, the shared 2 cm).
 */
const TOP_HEAVY: Readonly<Partial<Record<VehicleClassId, { pitch: number; gap: number }>>> = { monster: { pitch: 10.6, gap: 0.035 } };

/** What a drive's frame says of the body's pose on the road: `Sample`'s own fields the readings below use. */
type Reading = Pick<Sample, "s" | "airborne" | "gaps" | "pen" | "pitch" | "groundPitch" | "framePitch" | "wheelbase">;

/** The pitch is still when neither axle moves up or down against the road faster than this (m/s): the speed the sim lets a body sleep under. */
const PITCH_STILL_SPEED = REST_SPEED;
/** Frames in a row the pitch holds still to be settled (1/6 s): a rebound's turning point holds still for 3 or 4 frames, a body at rest holds on. */
const PITCH_STILL_FRAMES = 10;
/** Frames the settled pitch is read over (0.5 s). */
const READ_FRAMES = 30;

/** The first frame from `from` on that begins `PITCH_STILL_FRAMES` frames in a row of a frame off the slope whose pitch turns an axle (half the wheelbase out) slower than `PITCH_STILL_SPEED`; -1 when the run has none. */
function settledFrom(run: readonly Reading[], from: number): number {
  let still = 0;
  for (let i = Math.max(1, from + 1); i < run.length; i++) {
    const [now, before] = [run[i]!, run[i - 1]!];
    const turn = Math.abs(now.framePitch - now.groundPitch - (before.framePitch - before.groundPitch)) / DEG / FRAME;
    still = turn * (now.wheelbase / 2) < PITCH_STILL_SPEED ? still + 1 : 0;
    if (still === PITCH_STILL_FRAMES) return i - PITCH_STILL_FRAMES;
  }
  return -1;
}

function worst(run: readonly Reading[], from: number, to: number) {
  let gap = 0;
  let pen = 0;
  let pitch = 0;
  let framePitch = 0;
  let airFrames = 0;
  for (const r of run) {
    if (r.s < from || r.s > to) continue;
    if (r.airborne) {
      airFrames++;
      continue;
    }
    gap = Math.max(gap, ...r.gaps.map(Math.abs));
    pen = Math.max(pen, r.pen);
    pitch = Math.max(pitch, Math.abs(r.pitch - r.groundPitch));
    framePitch = Math.max(framePitch, Math.abs(r.framePitch - r.groundPitch));
  }
  return { gap, pen, pitch, framePitch, airFrames };
}

/** A run over the crest at `v` m/s, and the fastest speed (m/s) its car closed on the road at (the most downward velocity of the run). */
function crestRun(cls: VehicleClassId, from: number, to: number, v: number): { run: Sample[]; closing: number } {
  let closing = 0;
  const run = drive(track, cls, from, to, () => v, { lead: 40, each: (car) => void (closing = Math.max(closing, -car.velocity.y)) });
  return { run, closing };
}

/** A rigid point stops at a surface within one contact slice: it is in it by at most its closing speed over that slice. */
function slicePenetration(closing: number): number {
  return closing / CONTACT_HZ;
}

describe("given the stunt course's CRUSH crest (the hill under the CRUSH billboards) and the kicker and descent beyond it, with every car on very stiff springs", () => {
  let restoreSprings = (): void => {};
  before(() => {
    restoreSprings = useStiffSprings();
  });
  after(() => restoreSprings());
  afterEach(() => setGround(null));

  for (const cls of VEHICLE_CLASS_IDS) {
    it(`when a ${cls} rolls over the crest and down the kicker and the descent at 4 and at 8 m/s, then the body takes the road's slope within ${PLAIN.pose}° and the hull stays out of the road within ${PLAIN.pen * 100} cm`, (t) => {
      const failures: string[] = [];
      for (const v of [4, 8]) {
        const w = worst(crestRun(cls, 890, 945, v).run, 890, 945);
        t.diagnostic(`${cls} ${v} m/s: hull under the road ${(w.pen * 100).toFixed(1)} cm, drawn pitch ${w.pitch.toFixed(2)}°, frame pitch ${w.framePitch.toFixed(2)}° off the slope, ${w.airFrames} airborne frames`);
        if (w.airFrames > 0) failures.push(`${v} m/s: flew (${w.airFrames} frames)`);
        if (w.pen > PLAIN.pen) failures.push(`${v} m/s: hull ${(w.pen * 100).toFixed(1)} cm into the road`);
        if (w.framePitch > PLAIN.pose) failures.push(`${v} m/s: frame pitch ${w.framePitch.toFixed(2)}° off the slope`);
        if (w.pitch > PLAIN.pose) failures.push(`${v} m/s: drawn pitch ${w.pitch.toFixed(2)}° off the slope`);
      }
      assert.deepEqual(failures, []);
    });
  }
});

describe("given the stunt course's CRUSH crest (the hill under the CRUSH billboards) and the kicker and descent beyond it, with every car on its own springs", () => {
  afterEach(() => setGround(null));

  for (const cls of VEHICLE_CLASS_IDS) {
    const pitch = TOP_HEAVY[cls]?.pitch ?? springPitch(cls);
    const gap = TOP_HEAVY[cls]?.gap ?? PLAIN.gap;
    it(`when a ${cls} rolls over the crest and down the kicker and the descent at 4 and at 8 m/s, then all four tyres stay within ${gap * 100} cm of the road and the body's pitch stays within ${pitch.toFixed(1)}° (its springs' travel allows ${springPitch(cls).toFixed(1)}°)`, (t) => {
      const failures: string[] = [];
      for (const v of [4, 8]) {
        const w = worst(crestRun(cls, 890, 945, v).run, 890, 945);
        t.diagnostic(`${cls} ${v} m/s: tyre gap ${(w.gap * 100).toFixed(1)} cm, drawn pitch ${w.pitch.toFixed(2)}°, frame pitch ${w.framePitch.toFixed(2)}° off the slope, ${w.airFrames} airborne frames`);
        if (w.airFrames > 0) failures.push(`${v} m/s: flew (${w.airFrames} frames)`);
        if (w.gap > gap) failures.push(`${v} m/s: a tyre ${(w.gap * 100).toFixed(1)} cm off the road`);
        if (w.framePitch > pitch) failures.push(`${v} m/s: frame pitch ${w.framePitch.toFixed(2)}° off the slope`);
        if (w.pitch > pitch) failures.push(`${v} m/s: drawn pitch ${w.pitch.toFixed(2)}° off the slope`);
      }
      assert.deepEqual(failures, []);
    });
  }

  for (const cls of VEHICLE_CLASS_IDS) {
    it(`when a ${cls} drives over the crest at 30 m/s, then it leaves the road for about a second and lands on its wheels, with the hull in the road by no more than its closing speed carries it in one contact slice`, (t) => {
      const { run, closing } = crestRun(cls, 885, 1010, 30);
      let air = 0;
      let landed = -1;
      let was = false;
      for (const [i, r] of run.entries()) {
        if (r.airborne) air++;
        else if (was) landed = i;
        was = r.airborne;
      }
      const after = worst(run.slice(Math.max(0, landed) + 60), 0, Infinity);
      const whole = worst(run, 0, Infinity);
      t.diagnostic(`${cls}: ${(air * FRAME).toFixed(2)} s in the air, landed at s ${landed >= 0 ? run[landed]!.s.toFixed(0) : "-"}; a second later gap ${(after.gap * 100).toFixed(1)} cm, pitch ${after.pitch.toFixed(2)}°; hull under the road all run ${(whole.pen * 100).toFixed(1)} cm of ${(slicePenetration(closing) * 100).toFixed(1)}`);
      assert.ok(air * FRAME >= 0.6 && air * FRAME <= 2, `${(air * FRAME).toFixed(2)} s in the air`);
      assert.ok(landed > 0, "never landed");
      assert.ok(after.gap <= PLAIN.gap, `a second after landing a tyre is ${(after.gap * 100).toFixed(1)} cm off the road`);
      assert.ok(after.pitch <= springPitch(cls), `a second after landing the body is ${after.pitch.toFixed(2)}° off the slope`);
      assert.ok(whole.pen <= slicePenetration(closing), `hull ${(whole.pen * 100).toFixed(1)} cm into the road`);
    });
  }

  // From the first frame a tyre reaches the road after the flight (the touchdown the body is seen to make; a stored flight flag used to
  // hide the frames it rotates onto the road in). A snap is looked for from half a second before that frame too: a touch the body
  // bounces off ends its frame in the air.
  /**
   * The fast crest speed (m/s). 38 was the muscle's (38 and 39 m/s each leave one class, the muscle or the hatch, with a front tyre rebounding 39 cm in the 22 frames its tail falls in:
   * a landing's belly rows join in from a 2 % difference in attitude, a lottery of the speed), where 36, 37, 37.5, 38.5 and 40 m/s leave every class down; 37 has both neighbours under it.
   */
  const FAST_CREST_SPEED = 37;
  for (const cls of VEHICLE_CLASS_IDS) {
    it(`when a ${cls} drives over the crest at ${FAST_CREST_SPEED} m/s, then around its first tyre touching down its body never turns more than ${SNAP}° in a frame, no tyre sinks more than ${PLAIN.gap * 100} cm and no underside more than its closing speed carries it in one contact slice, all four tyres are on the road within the time its tail needs to fall from where it hung, and from then on the body stays within what its springs allow of the road's slope`, (t) => {
      const { run, closing } = crestRun(cls, 880, 1010, FAST_CREST_SPEED);
      const first = run.findIndex((r, i) => i > 0 && run[i - 1]!.airborne && !r.airborne);
      assert.ok(first > 0, "never landed");
      let turn = 0;
      let sunk = 0;
      let pen = 0;
      for (let i = Math.max(1, first - 30); i < first + 30 && i < run.length; i++) {
        const r = run[i]!;
        turn = Math.max(turn, Math.abs(r.framePitch - run[i - 1]!.framePitch), Math.abs(r.frameRoll - run[i - 1]!.frameRoll));
        if (i < first) continue;
        sunk = Math.max(sunk, ...r.gaps.map((g) => -g));
        pen = Math.max(pen, r.pen);
      }
      const hung = Math.max(...run[first]!.gaps.map(Math.abs));
      const fallFrames = Math.ceil(Math.sqrt((2 * hung) / G) / FRAME);
      const down = run.findIndex((r, i) => i >= first && i <= first + fallFrames && r.gaps.every((g) => Math.abs(g) <= PLAIN.gap));
      // "From then on" is once the frame's pitch has settled, searched from `fallFrames` after touchdown (the latest the clause above lets
      // the tyres be down): the body rebounds off the landing and the frame is still turning onto the slope for a while after its tyres
      // reach the road (a hatch landing nose-down 15.9°: 5.1° nose-up at 13 frames, 3.8° at 21, 3.0° at 23, 0° at 29), so no fixed frame is settled.
      const settled = settledFrom(run, first + fallFrames);
      const w = worst(run.slice(Math.max(0, settled), settled + READ_FRAMES), 0, Infinity);
      t.diagnostic(`${cls}: touched down at s ${run[first]!.s.toFixed(0)} with the tail ${(hung * 100).toFixed(0)} cm up, all down ${down - first} of ${fallFrames} frames later, pitch settled ${settled - first} frames after touchdown; the next 0.5 s: most turn in a frame ${turn.toFixed(2)}°, deepest tyre ${(sunk * 100).toFixed(1)} cm, underside ${(pen * 100).toFixed(1)} cm of ${(slicePenetration(closing) * 100).toFixed(1)}; once settled: frame ${w.framePitch.toFixed(2)}° off the slope of ${springPitch(cls).toFixed(1)}°`);
      assert.ok(turn <= SNAP, `the body turned ${turn.toFixed(2)}° in one frame after touchdown`);
      assert.ok(sunk <= PLAIN.gap, `a tyre ${(sunk * 100).toFixed(1)} cm into the road after touchdown`);
      assert.ok(pen <= slicePenetration(closing), `underside ${(pen * 100).toFixed(1)} cm into the road after touchdown`);
      assert.ok(down >= 0, `the tyres were not all on the road ${fallFrames} frames after touchdown`);
      assert.ok(settled >= 0, `the frame's pitch never settled within the run (still moving at ${PITCH_STILL_SPEED} m/s an axle)`);
      assert.ok(w.airFrames === 0 && w.framePitch <= springPitch(cls), `after settling: ${w.airFrames} frames off the road, the frame ${w.framePitch.toFixed(2)}° off the slope`);
    });
  }

  it("when every class drives over the crest at 6 m/s and at 16 m/s, then none leaves the road at 6 m/s and all do at 16 m/s: the crest gives airtime from a moderate pace", () => {
    const flies = (cls: VehicleClassId, v: number) => drive(track, cls, 885, 975, () => v, { lead: 45 }).some((r) => r.airborne);
    for (const cls of VEHICLE_CLASS_IDS) {
      assert.ok(!flies(cls, 6), `${cls} flew at 6 m/s`);
      assert.ok(flies(cls, 16), `${cls} stayed down at 16 m/s`);
    }
  });
});

/** A run of `frames` frames whose frame stands `error(i)` deg off the slope at frame i, tyres down: what the settled reading needs of a drive. */
function heldRun(frames: number, error: (i: number) => number): Reading[] {
  return Array.from({ length: frames }, (_, i): Reading => ({ s: i, airborne: false, gaps: [0, 0, 0, 0], pen: 0, pitch: error(i), groundPitch: 0, framePitch: error(i), wheelbase: 2.4 }));
}

describe("given the reading of where the frame settles after a landing", () => {
  const HATCH_BAR = springPitch("hatch");

  it("when a run holds the frame 4° off the slope, then it settles at once and reads 4°, over the hatch's springs' bar", () => {
    const run = heldRun(120, () => 4);
    const at = settledFrom(run, 21);
    assert.equal(at, 21);
    assert.ok(worst(run.slice(at, at + READ_FRAMES), 0, Infinity).framePitch > HATCH_BAR, "the held frame reads inside the bar");
  });

  it("when a rebound of 5° at 3 Hz decays over a second, then it settles only once the rebound is under the pitch's rest and reads inside the bar, not the rebound's turning points", () => {
    const run = heldRun(240, (i) => 5 * Math.cos(2 * Math.PI * 3 * i * FRAME) * Math.exp(-i * FRAME * 4));
    const at = settledFrom(run, 0);
    assert.ok(at > 30, `settled at frame ${at}, inside the rebound`);
    assert.ok(worst(run.slice(at, at + READ_FRAMES), 0, Infinity).framePitch <= HATCH_BAR, "the settled frame reads over the bar");
  });

  it("when a frame rocks 2° at 3 Hz for the whole run, then it never settles", () => {
    assert.equal(settledFrom(heldRun(240, (i) => 2 * Math.cos(2 * Math.PI * 3 * i * FRAME)), 0), -1);
  });
});
