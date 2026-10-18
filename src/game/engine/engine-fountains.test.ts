import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { setImmediate as yieldToLoop } from "node:timers/promises";
import { PerformanceObserver } from "node:perf_hooks";
import * as THREE from "three";
import { FRAME_HZ, GRAVITY } from "../kernel/constants.ts";
import { FountainSystem, JET_FADE_S, JET_RATE, JET_SLOTS, JET_UP_MAX } from "../present/engine-fx.ts";
import type { FxTier } from "../present/engine-post.ts";
import { APPROACH_LEAD_S, APPROACH_RUN_S, FOUNTAIN_TIER, LINE_POWER, ROAD_MARGIN, ROW_GAP, RUNUP_ROWS, RUNUP_ROW_GAP } from "../present/fountain-plan.ts";
import { RANGE } from "../scenes/range.ts";
import { MINIGAME_MODE, MINIGAME_MODES, STATION_ANCHORS, STATION_HALF_WIDTH, type MinigameMode } from "../scenes/minigame-constants.ts";
import { floorHeightAt, stationStartPose } from "../scenes/minigame-profile.ts";
import { Fountains } from "./engine-fountains.ts";
import type { RaceField } from "./engine-race-field.ts";

/**
 * The celebration fountains without an engine: the jet pool's timing, count, arc and fade, then the two triggers (the race's last-lap
 * run-in, the Range's launch) against a stand-in race. The real engine's wiring is `engine-fountains-engine.test.ts`.
 */

// The fx pools paint their dot sprites on a canvas; the headless run lends them one that takes any draw.
const ctx = { createRadialGradient: () => ({ addColorStop() {} }), fillRect() {}, fillStyle: "" };
const CANVAS = { createElement: () => ({ width: 0, height: 0, getContext: () => ctx }) };

const STEP = 1 / FRAME_HZ;
/** The explicit step runs a spark's position before its speed, so its path overshoots the true apex by up to half a step of its launch speed (16 m/s x 1/60 s / 2 = 0.14 m). */
const APEX_OVERSHOOT = 0.2;
const TIERS: readonly FxTier[] = ["off", "minimal", "low", "high", "ultra"];
/** What each tier throws, as the brief reads: off none, minimal a single thin pair, ultra the full show; stated here, not read back from the plan's table. */
const RACE_JETS: Readonly<Record<FxTier, number>> = { off: 0, minimal: 2, low: 4, high: 6, ultra: 8 };
const RANGE_JETS: Readonly<Record<FxTier, number>> = { off: 0, minimal: 2, low: 4, high: 6, ultra: 6 };

let scene: THREE.Scene;
before(() => {
  Object.defineProperty(globalThis, "document", { value: CANVAS, configurable: true });
});
after(() => {
  Reflect.deleteProperty(globalThis, "document");
});

function pool(): FountainSystem {
  scene = new THREE.Scene();
  return new FountainSystem(scene);
}

const alive = (sys: FountainSystem): number => sys["life"].filter((life) => life > 0).length;
const run = (sys: { update(dt: number): void }, seconds: number): void => {
  for (let i = 0; i < Math.round(seconds / STEP); i++) sys.update(STEP);
};

describe("given a fountain jet", () => {
  it("when it is scheduled 1 s ahead, then nothing flies before then and sparks fly after", () => {
    const sys = pool();
    sys.jet(0, 0, 0, 1, 2);
    run(sys, 0.9);
    assert.equal(alive(sys), 0, "no spark before its start");
    run(sys, 0.3);
    assert.ok(alive(sys) > 0, "sparks after its start");
  });

  it("when it runs 1.2 s at full density, then it has thrown JET_RATE sparks a second", () => {
    const sys = pool();
    sys.jet(0, 0, 0, 0, 1.2);
    run(sys, 1.2);
    // Every spark of this run is still in the air (the shortest flight is 1.67 s); two are the frame rounding.
    assert.ok(Math.abs(alive(sys) - 1.2 * JET_RATE) <= 2, `${alive(sys)} sparks in the air, wanted ${1.2 * JET_RATE}`);
  });

  it("when the density is halved, then half the sparks are thrown; at 0 none", () => {
    const half = pool();
    half.density = 0.5;
    half.jet(0, 0, 0, 0, 1.2);
    run(half, 1.2);
    assert.ok(Math.abs(alive(half) - 0.6 * JET_RATE) <= 2, `${alive(half)} sparks at density 0.5`);
    const none = pool();
    none.density = 0;
    none.jet(0, 0, 0, 0, 1.2);
    run(none, 1.2);
    assert.equal(alive(none), 0, "no spark at density 0");
  });

  it("when the line's big jet runs beside a plain one, then it throws LINE_POWER times the sparks", () => {
    const plain = pool();
    plain.jet(0, 0, 0, 0, 1.2);
    run(plain, 1.2);
    const big = pool();
    big.jet(0, 0, 0, 0, 1.2, LINE_POWER);
    run(big, 1.2);
    assert.ok(Math.abs(alive(big) / alive(plain) - LINE_POWER) < 0.05, `${alive(big)} against ${alive(plain)}`);
  });

  it("when it throws, then every spark stays between the nozzle's height and its own arc's apex, and none is left after the last lands", () => {
    const sys = pool();
    const nozzleY = 3;
    sys.jet(5, nozzleY, 7, 0, 2);
    const apex = nozzleY + (JET_UP_MAX * JET_UP_MAX) / (2 * GRAVITY);
    let top = nozzleY;
    let low = nozzleY;
    for (let i = 0; i < Math.round(6 / STEP); i++) {
      sys.update(STEP);
      for (let k = 0; k < sys["n"]; k++) {
        if (sys["life"][k]! <= 0) continue;
        top = Math.max(top, sys["pos"][k * 3 + 1]!);
        low = Math.min(low, sys["pos"][k * 3 + 1]!);
      }
    }
    assert.ok(top > nozzleY + 3 && top <= apex + APEX_OVERSHOOT, `the highest spark reached ${top.toFixed(2)} m, the arc's apex is ${apex.toFixed(2)} m`);
    assert.ok(low >= nozzleY - 0.2, `a spark fell to ${low.toFixed(2)} m below the nozzle`);
    assert.equal(alive(sys), 0, "every spark has landed");
    assert.equal(sys.jets, 0, "the jet is spent");
  });

  it("when sparks are in the air, then each fades to nothing over its last JET_FADE_S and is full before", () => {
    const sys = pool();
    sys.jet(0, 0, 0, 0, 1);
    run(sys, 2.6);
    let fading = 0;
    let full = 0;
    for (let k = 0; k < sys["n"]; k++) {
      const life = sys["life"][k]!;
      if (life <= 0) continue;
      const want = Math.min(1, life / JET_FADE_S);
      const got = sys["tint"]![k * 3]! / sys["base"][k * 3]!;
      assert.ok(Math.abs(got - want) < 0.02, `a spark with ${life.toFixed(2)} s left is at ${got.toFixed(2)}, wanted ${want.toFixed(2)}`);
      if (want < 1) fading++;
      else full++;
    }
    assert.ok(fading > 0 && full > 0, `${fading} fading, ${full} full: both must exist at 2.6 s`);
  });

  it("when a colour is given, then its sparks carry that colour", () => {
    const sys = pool();
    sys.jet(0, 0, 0, 0, 0.5, 1, new THREE.Color(0.2, 0.4, 0.8));
    run(sys, 0.5);
    const k = sys["life"].findIndex((life) => life > JET_FADE_S);
    assert.ok(k >= 0, "a spark at full brightness");
    assert.ok(Math.abs(sys["tint"]![k * 3]! - 0.2) < 1e-6 && Math.abs(sys["tint"]![k * 3 + 1]! - 0.4) < 1e-6 && Math.abs(sys["tint"]![k * 3 + 2]! - 0.8) < 1e-6);
  });

  it("when more jets are asked for than the table holds, then the extra ones are dropped, and a spent jet frees its slot", () => {
    const sys = pool();
    for (let k = 0; k < JET_SLOTS + 3; k++) sys.jet(k, 0, 0, 0, 0.1);
    assert.equal(sys.jets, JET_SLOTS);
    run(sys, 0.2);
    assert.equal(sys.jets, 0);
    sys.jet(0, 0, 0, 0, 1);
    assert.equal(sys.jets, 1);
  });

  it("when reset, then no jet and no spark is left and the pool is not drawn", () => {
    const sys = pool();
    sys.jet(0, 0, 0, 0, 2);
    sys.jet(3, 0, 0, 5, 2);
    run(sys, 0.5);
    assert.ok(alive(sys) > 0 && sys["points"].visible);
    sys.reset();
    assert.equal(alive(sys), 0);
    assert.equal(sys.jets, 0);
    assert.equal(sys["points"].visible, false);
    run(sys, 1);
    assert.equal(alive(sys), 0, "the jet that was waiting never starts");
  });

  it("when idle, then the pool is not drawn", () => {
    assert.equal(pool()["points"].visible, false);
  });

  it("when eight jets run at 60 Hz, then no frame allocates (no collection runs)", async () => {
    const sys = pool();
    for (let k = 0; k < 8; k++) sys.jet(k * 4, 0, 0, 0, 1000, k < 2 ? LINE_POWER : 1);
    const watch = new PerformanceObserver(() => {});
    watch.observe({ entryTypes: ["gc"] });
    // The earlier rows left garbage (each built a pool): a first stretch lets the collector take it, and only the second is counted.
    run(sys, 120);
    await yieldToLoop();
    watch.takeRecords();
    run(sys, 600);
    // The collector's entries reach the observer through the event loop: let them in before counting.
    await yieldToLoop();
    const collections = watch.takeRecords().length;
    watch.disconnect();
    assert.equal(collections, 0, "a collection ran inside 36000 frames of eight running jets");
  });
});

/** The race a `Fountains` reads: the metres left on the last lap, and the road's sides at each distance back from the line. */
function standIn(left: () => number): { race: RaceField; asked: { behind: number; side: number; margin: number }[] } {
  const asked: { behind: number; side: number; margin: number }[] = [];
  const race = {
    lastLapLeft: () => left(),
    roadsideAt: (behind: number, side: number, margin: number, out: THREE.Vector3) => {
      asked.push({ behind, side, margin });
      out.set(100 - behind, 0.5, side * 12);
      return true;
    },
  } as unknown as RaceField;
  return { race, asked };
}

function fountains(tier: FxTier): Fountains {
  const f = new Fountains(new THREE.Scene());
  f.setLook(tier, 1);
  return f;
}

describe("given a race on its last lap", () => {
  const SPEED = 40;
  /** Metres from the line at which the run-in's pair `k` is just due at `SPEED`. */
  const dueAt = (k: number): number => k * ROW_GAP + SPEED * APPROACH_LEAD_S;

  for (const tier of TIERS) {
    it(`when the car is on the run-in at ${tier}, then ${RACE_JETS[tier]} jets stand, a pair per row`, () => {
      const f = fountains(tier);
      f.raceFrame(standIn(() => 3 * ROW_GAP).race, 0, SPEED);
      assert.equal(f.jets.jets, RACE_JETS[tier]);
    });
  }

  it("when the car is on an earlier lap, then no jet starts however near the line it is", () => {
    const f = fountains("ultra");
    f.raceFrame(standIn(() => NaN).race, 0, SPEED);
    assert.equal(f.jets.jets, 0);
  });

  it("when the car closes on the line, then the rows light one after the other from the farthest back, each in its arrival order", () => {
    const f = fountains("ultra");
    let left = dueAt(3) + 1;
    const { race, asked } = standIn(() => left);
    f.raceFrame(race, 0, SPEED);
    assert.equal(f.jets.jets, 0, "no row is due yet");
    for (const k of [3, 2, 1, 0]) {
      left = dueAt(k) - 1;
      f.raceFrame(race, 0, SPEED);
      assert.equal(f.jets.jets, 2 * (4 - k), `row ${k} lit, the rows behind it already burning`);
    }
    assert.equal(asked.map((a) => a.behind).join(), "66,66,44,44,22,22,0,0", "rows 66, 44, 22 and 0 m before the line, back to front");
    assert.equal(asked.map((a) => a.side).join(), "-1,1,-1,1,-1,1,-1,1", "one jet each side of the road");
    assert.ok(asked.every((a) => a.margin === ROAD_MARGIN));
  });

  it("when the car is slow, then the show waits for it: a car at 0 m/s is timed at the floor speed, not at infinity", () => {
    const f = fountains("ultra");
    f.raceFrame(standIn(() => 150).race, 0, 0);
    assert.equal(f.jets.jets, 0, "150 m from the line at a standstill");
    f.raceFrame(standIn(() => 10).race, 0, 0);
    assert.equal(f.jets.jets, 2, "10 m from the line: the line's pair; the rows back down the run-in are behind the car");
  });

  it("when the car is past a row, then that row never starts, and once it is across the line nothing starts at all", () => {
    const f = fountains("ultra");
    f.raceFrame(standIn(() => 10).race, 0, SPEED);
    assert.equal(f.jets.jets, 2, "10 m out: the line's pair alone");
    const g = fountains("ultra");
    g.raceFrame(standIn(() => -1).race, 0, SPEED);
    assert.equal(g.jets.jets, 0, "past the line");
  });

  it("when the rows have started, then they never start again that race, and a new run re-arms them", () => {
    const f = fountains("high");
    const { race, asked } = standIn(() => 3 * ROW_GAP);
    f.raceFrame(race, 0, SPEED);
    const started = asked.length;
    f.raceFrame(race, 0, SPEED);
    f.raceFrame(race, 0, SPEED);
    assert.equal(asked.length, started, "no second start");
    f.reset();
    assert.equal(f.jets.jets, 0, "the reset stops the jets");
    f.raceFrame(race, 0, SPEED);
    assert.equal(asked.length, 2 * started, "the new run's last lap starts them again");
  });

  it("when the jets start, then each runs the lead, the arrival and the seconds after it", () => {
    const f = fountains("minimal");
    f.raceFrame(standIn(() => 0).race, 0, SPEED);
    assert.ok(f.jets["run"].some((run) => Math.abs(run - APPROACH_RUN_S) < 1e-4), `a jet runs ${APPROACH_RUN_S} s`);
    assert.equal(f.jets["wait"].filter((wait) => wait > 0).length, 0, "they start at once");
  });

  it("when the line's pair and a row's are compared, then the line's is the bigger", () => {
    const f = fountains("ultra");
    f.raceFrame(standIn(() => 3 * ROW_GAP).race, 0, SPEED);
    const powers = [...f.jets["power"]].slice(0, 8);
    assert.ok(powers.slice(0, 2).every((p) => Math.abs(p - LINE_POWER) < 0.01), "the line's pair throws at LINE_POWER");
    assert.ok(powers.slice(2).every((p) => p === 1));
  });

  it("when the spray is set from the tier and the density knob, then it is their product, thin at minimal and full at ultra", () => {
    const f = new Fountains(new THREE.Scene());
    f.setLook("high", 1.5);
    assert.ok(Math.abs(f.jets.density - FOUNTAIN_TIER.high.spray * 1.5) < 1e-9);
    const sprays = TIERS.map((tier) => {
      f.setLook(tier, 1);
      return f.jets.density;
    });
    assert.equal(sprays[0], 0, "off throws nothing");
    assert.equal(sprays[4], 1, "ultra is the full spray");
    assert.ok(sprays[1]! > 0 && sprays[1]! < sprays[2]! && sprays[2]! < sprays[3]! && sprays[3]! < sprays[4]!, `thicker with each tier: ${sprays.join(", ")}`);
  });
});

describe("given the Range's car on its run-up", () => {
  /** The jets standing, with where: world x, y, z of each. */
  const jets = (f: Fountains): { x: number; y: number; z: number }[] =>
    Array.from({ length: JET_SLOTS }, (_, s) => s)
      .filter((s) => f.jets["run"][s]! > 0)
      .map((s) => ({ x: f.jets["jx"][s]!, y: f.jets["jy"][s]!, z: f.jets["jz"][s]! }));
  const SPEED = 25;
  /** World x of the lip (the barrier's, in the Long jump) of `mode`; the plain Range's wall is the origin. */
  const lipX = (mode: MinigameMode | null): number => (mode === null ? 0 : STATION_ANCHORS[mode].x);
  const MODES: readonly (MinigameMode | null)[] = [null, ...MINIGAME_MODES];
  /** The car's x with every row of the run-up ahead of it. */
  const behindAllRows = (mode: MinigameMode | null): number => lipX(mode) - RUNUP_ROWS * RUNUP_ROW_GAP;

  for (const tier of TIERS) {
    it(`when the car is on the ramp at ${tier}, then ${RANGE_JETS[tier]} jets stand, two to a row`, () => {
      const f = fountains(tier);
      f.runUpFrame(null, behindAllRows(null), SPEED);
      assert.equal(f.jets.jets, RANGE_JETS[tier]);
    });
  }

  for (const mode of MODES) {
    it(`when the car nears the lip at ultra (${mode ?? "plain Range"}), then three rows of two stand along both edges of the run-up, the big pair at the lip, and none stands past it`, () => {
      const f = fountains("ultra");
      f.runUpFrame(mode, behindAllRows(mode), SPEED);
      const placed = jets(f);
      assert.equal(placed.length, 6);
      const z0 = mode === null ? 0 : STATION_ANCHORS[mode].z;
      const edge = mode === null ? RANGE.halfWidth + 1 : STATION_HALF_WIDTH;
      assert.equal(new Set(placed.map((j) => j.z)).size, 2, "a jet on each edge");
      assert.ok(placed.every((j) => Math.abs(Math.abs(j.z - z0) - edge) < 1e-6), `every jet stands ${edge} m off the lane's middle`);
      for (let row = 0; row < RUNUP_ROWS; row++) {
        assert.equal(placed.filter((j) => Math.abs(j.x - (lipX(mode) - row * RUNUP_ROW_GAP)) < 1e-6).length, 2, `a pair ${row * RUNUP_ROW_GAP} m back from the lip`);
      }
      assert.ok(placed.every((j) => j.x <= lipX(mode)), "none past the lip");
      for (const j of placed) assert.ok(Math.abs(j.y - (mode === null ? 0 : floorHeightAt(mode, j.x - lipX(mode), 0))) < 1e-4, `a jet stands on the floor under it (y ${j.y})`);
    });
  }

  it("when the lip's pair and a row's are compared, then the lip's is the bigger", () => {
    const f = fountains("ultra");
    f.runUpFrame(MINIGAME_MODE.highJump, behindAllRows(MINIGAME_MODE.highJump), SPEED);
    const standing = Array.from({ length: JET_SLOTS }, (_, s) => s).filter((s) => f.jets["run"][s]! > 0);
    const power = (x: number): number[] => standing.filter((s) => Math.abs(f.jets["jx"][s]! - x) < 1e-4).map((s) => f.jets["power"][s]!);
    const lipPair = power(lipX(MINIGAME_MODE.highJump));
    assert.ok(lipPair.length === 2 && lipPair.every((p) => Math.abs(p - LINE_POWER) < 0.01), `the lip's pair throws at LINE_POWER (${lipPair.join(", ")})`);
    assert.ok([...power(-RUNUP_ROW_GAP), ...power(-2 * RUNUP_ROW_GAP)].every((p) => p === 1));
  });

  for (const mode of MODES) {
    it(`when the car is parked at its start (${mode ?? "plain Range, 40 m out and still"}), then nothing fires`, () => {
      const f = fountains("ultra");
      const startX = mode === null ? -RANGE.run : STATION_ANCHORS[mode].x + stationStartPose(mode).x;
      f.runUpFrame(mode, startX, 0);
      assert.equal(f.jets.jets, 0);
    });
  }

  for (const mode of MINIGAME_MODES) {
    it(`when the car accelerates up the ${mode} run-up, then the rows light back to front, each as the car comes a lead's travel from it, the lip's pair last`, () => {
      const f = fountains("ultra");
      const lip = lipX(mode);
      const order: number[] = [];
      let x = lip + stationStartPose(mode).x;
      let v = 0;
      for (let t = 0; t < 40 && order.length < RUNUP_ROWS; t += STEP) {
        v = Math.min(30, v + 6 * STEP);
        x += v * STEP;
        f.runUpFrame(mode, x, v);
        for (const j of jets(f)) {
          const row = Math.round((lip - j.x) / RUNUP_ROW_GAP);
          if (order.includes(row)) continue;
          order.push(row);
          const toGo = j.x - x;
          const reach = Math.max(v, 8) * APPROACH_LEAD_S;
          assert.ok(toGo >= 0 && toGo <= reach, `row ${row} started ${toGo.toFixed(1)} m ahead of the car at ${v.toFixed(1)} m/s`);
          assert.ok(toGo > reach - 2, `row ${row} started as the car came within the lead, not before (${toGo.toFixed(1)} m of ${reach.toFixed(1)})`);
        }
      }
      assert.deepEqual(order, [2, 1, 0], "back to front");
    });
  }

  it("when the car is already past the lip, then no row starts", () => {
    for (const mode of MODES) {
      const f = fountains("ultra");
      f.runUpFrame(mode, lipX(mode) + 0.5, 30);
      assert.equal(f.jets.jets, 0, `${mode ?? "plain Range"}: nothing starts once the car is by`);
    }
  });

  it("when the car is past a back row but short of the lip, then only the rows ahead of it start", () => {
    const f = fountains("ultra");
    f.runUpFrame(null, -RUNUP_ROW_GAP / 3, SPEED);
    assert.equal(f.jets.jets, 2, "the lip's pair alone: the others are behind the car");
  });

  it("when the next attempt comes after a reset, then the rows fire again; without one they do not", () => {
    const f = fountains("high");
    f.runUpFrame(null, behindAllRows(null), SPEED);
    assert.equal(f.jets.jets, 6);
    f.runUpFrame(null, behindAllRows(null), SPEED);
    assert.equal(f.jets.jets, 6, "no second start");
    f.reset();
    assert.equal(f.jets.jets, 0);
    f.runUpFrame(null, behindAllRows(null), SPEED);
    assert.equal(f.jets.jets, 6);
  });

  it("when the jets start, then each runs through the launch: the lead, the arrival and the seconds after", () => {
    const f = fountains("minimal");
    f.runUpFrame(MINIGAME_MODE.ringFling, STATION_ANCHORS.ringFling.x - 10, SPEED);
    assert.ok(f.jets["run"].some((r) => Math.abs(r - APPROACH_RUN_S) < 1e-4));
    assert.equal(f.jets["wait"].filter((wait) => wait > 0).length, 0, "they start at once");
  });
});
