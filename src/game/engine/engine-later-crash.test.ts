import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import "../kernel/rapier-node.test-util.ts";
import { HudStore } from "../hud/hud-store.ts";
import type { ContactHit } from "../scenes/engine-props.ts";
import { setGround } from "../world/ground.ts";
import { impactScale, type PhaseClock } from "../match/phase.ts";
import { CrashEngine } from "./engine.ts";
import { element, stubBrowser } from "./engine-headless.test-util.ts";
import { FRAME_HZ } from "../kernel/constants.ts";

const FRAME = 1 / FRAME_HZ;
/** Canary: the time scale as the second pair meets, in multiples of the slow scale (the pre-impact ease lands within 1.2× of it). */
const REACHED_CANARY = 1.6;
/** Wall s the first crash's slow-mo is held here: shorter than the sandbox's, so the hand-back comes sooner; the rule under test is the second crash's. */
const SHORT_HOLD = 1;
/** The time scale the clock has eased back up to before the second pair is sent in: the speed-up between crashes. */
const BACK_UP = 0.9;
/** Frames the second pair has to meet in: the ease holds the slow scale for the last metre, so contact is about 2 s of wall after the send-in, give or take the step's lead. Twice that is "never". */
const MEET_WITHIN_FRAMES = 240;
/** Ms the pacer's clock moves at each read: no frame is cut at the wall deadline, whatever the box's load. */
const PACER_TICK_MS = 0.001;

/** The parts of the engine this file reaches: the private rules it drives are the ones under test. */
type Reach = {
  clock: PhaseClock;
  pairHit(a: number, b: number, hit: ContactHit): void;
  live(): { velocity: { set(x: number, y: number, z: number): void }; speed: number; spawnFacing(x: number, z: number, yaw: number, speed: number): void; spawnSpeed: number }[];
};

describe("given the real engine's fleet sandbox with two cars wrecked head-on and its slow-mo handed back to 1×", () => {
  let engine: CrashEngine;
  let e: Reach;
  before(async () => {
    stubBrowser();
    engine = new CrashEngine(element(), new HudStore(), element());
    Object.assign(engine["renderer"], { render() {}, compile() {}, compileAsync: () => Promise.resolve() });
    await engine.ready;
    engine.fadeScenes = false;
    e = engine as unknown as Reach;
    let tick = 0;
    Object.assign(engine.pace, { now: () => (tick += PACER_TICK_MS) });
    engine.pace.pin = true;
  });
  after(() => {
    engine.dispose();
    setGround(null);
  });

  /** Cars `i` and `i + 1` head-on 12 m apart along x at `z`, each at `speed` m/s. */
  const headOn = (i: number, z: number, speed: number): void => {
    for (const k of [i, i + 1]) {
      const dir = k === i ? 1 : -1;
      const car = e.live()[k]!;
      car.spawnFacing(-dir * 6, z, (dir * Math.PI) / 2, 0);
      car.velocity.set(dir * speed, 0, 0);
      car.speed = speed;
      car.spawnSpeed = speed;
    }
  };

  it("when two other cars then meet head-on at 24 m/s, then the time scale has dropped back to the slow scale by their contact", () => {
    engine["looping"] = false;
    const cars = e.live();
    assert.ok(cars.length >= 4, `${cars.length} cars`);
    for (const [k, car] of cars.entries()) {
      car.spawnFacing(8 * k - 16, 60 + 8 * k, 0, 0);
      car.speed = 0;
      car.spawnSpeed = 0;
    }
    headOn(0, 0, 12);
    let f = 0;
    for (; f < 300 && e.clock.phase === "approach"; f++) engine.advance(FRAME, { frameDt: FRAME });
    assert.notEqual(e.clock.phase, "approach", "the first pair never crashed");
    e.clock.hold = SHORT_HOLD;
    for (; f < 900 && !(e.clock.phase === "aftermath" && e.clock.timeScale > BACK_UP); f++) engine.advance(FRAME, { frameDt: FRAME });
    assert.ok(e.clock.timeScale > BACK_UP, `the slow-mo never handed back: scale ${e.clock.timeScale.toFixed(3)} ${e.clock.phase}`);
    const met: number[] = [];
    const pairHit = e.pairHit;
    e.pairHit = (a, b, hit) => {
      if (met.length === 0 && Math.min(a, b) === 2 && Math.max(a, b) === 3) met.push(e.clock.timeScale);
      pairHit(a, b, hit);
    };
    try {
      headOn(2, 30, 12);
      for (let g = 0; g < MEET_WITHIN_FRAMES && met.length === 0; g++) engine.advance(FRAME, { frameDt: FRAME });
    } finally {
      e.pairHit = pairHit;
    }
    assert.equal(met.length, 1, "the second pair never met");
    const slow = impactScale(e.clock);
    assert.ok(met[0]! <= slow * REACHED_CANARY, `time scale ${met[0]!.toFixed(3)} as the second pair met, slow scale ${slow}`);
  });
});
