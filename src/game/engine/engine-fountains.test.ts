import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { allocatedBytes, untilQuiet } from "../kernel/alloc-sample.test-util.ts";
import * as THREE from "three";
import { FRAME_HZ, GRAVITY, KPH_PER_MS } from "../kernel/constants.ts";
import { FountainSystem, JET_FADE_S, JET_RATE, JET_SLOTS, JET_UP_MAX } from "../present/fountain-system.ts";
import { sparkAt, sparkLives, sparkTint } from "../present/fountain-sparks.test-util.ts";
import type { FxTier } from "../present/engine-post.ts";
import { APPROACH_LEAD_S, APPROACH_RUN_S, FOUNTAIN_TIER, LINE_POWER, RACE_ROW_GAP, RANGE_ROW_GAP, ROAD_MARGIN, ROW_POWER, ROW_STAGGER_S, RUNUP_ROWS, STATION_ROW_GAP } from "../present/fountain-plan.ts";
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
/** A spark flies its exact parabola (the vertex shader's formula), so it peaks at its apex; this is the float32 rounding of its launch. */
const APEX_OVERSHOOT = 0.01;
const TIERS: readonly FxTier[] = ["off", "minimal", "low", "high", "ultra"];
/** What each tier throws, as the brief reads: off none, minimal a single thin pair, ultra the full show; stated here, not read back from the plan's table. */
const RACE_JETS: Readonly<Record<FxTier, number>> = { off: 0, minimal: 2, low: 4, high: 6, ultra: 8 };
const RANGE_JETS: Readonly<Record<FxTier, number>> = { off: 0, minimal: 2, low: 4, high: 6, ultra: 6 };
/** Frames of eight running jets one allocation read spans, and the bytes a frame may allocate: the sampling profiler's read of code that allocates nothing is zero, one boxed double a frame is 16. */
const ALLOC_SECONDS = 600;
const BOUND_B = 16;

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

const alive = (sys: FountainSystem): number => sparkLives(sys).filter((life) => life > 0).length;
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
    const spark = new THREE.Vector3();
    for (let i = 0; i < Math.round(6 / STEP); i++) {
      sys.update(STEP);
      for (const [k, life] of sparkLives(sys).entries()) {
        if (life <= 0) continue;
        sparkAt(sys, k, spark);
        top = Math.max(top, spark.y);
        low = Math.min(low, spark.y);
      }
    }
    assert.ok(top > nozzleY + 3 && top <= apex + APEX_OVERSHOOT, `the highest spark reached ${top.toFixed(2)} m, the arc's apex is ${apex.toFixed(2)} m`);
    assert.ok(low >= nozzleY - 0.2, `a spark fell to ${low.toFixed(2)} m below the nozzle`);
    assert.equal(alive(sys), 0, "every spark has landed");
    assert.equal(sys.jets, 0, "the jet is spent");
  });

  it("when sparks are in the air, then the ones in their last JET_FADE_S are dimmed in step with the time they have left, and the rest are full", () => {
    const sys = pool();
    sys.jet(0, 0, 0, 0, 1);
    run(sys, 2.6);
    let fading = 0;
    let full = 0;
    for (const [k, life] of sparkLives(sys).entries()) {
      if (life <= 0) continue;
      const want = Math.min(1, life / JET_FADE_S);
      assert.ok(Math.abs(sparkTint(sys, k, 0) / sys["spawnHue"][k * 3]! - want) < 1e-6, `a spark with ${life.toFixed(2)} s left is not at ${want.toFixed(2)}`);
      if (want < 1) fading++;
      else full++;
    }
    assert.ok(fading > 0 && full > 0, `${fading} fading, ${full} full: both must exist at 2.6 s`);
  });

  it("when a colour is given, then its sparks carry that colour", () => {
    const sys = pool();
    sys.jet(0, 0, 0, 0, 0.5, 1, new THREE.Color(0.2, 0.4, 0.8));
    run(sys, 0.5);
    const k = sparkLives(sys).findIndex((life) => life > JET_FADE_S);
    assert.ok(k >= 0, "a spark at full brightness");
    assert.ok(Math.abs(sparkTint(sys, k, 0) - 0.2) < 1e-6 && Math.abs(sparkTint(sys, k, 1) - 0.4) < 1e-6 && Math.abs(sparkTint(sys, k, 2) - 0.8) < 1e-6);
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

  it("when eight jets run at 60 Hz, then no frame allocates more than the bound", () => {
    const sys = pool();
    for (let k = 0; k < 8; k++) sys.jet(k * 4, 0, 0, 0, 1000, k < 2 ? LINE_POWER : 1);
    run(sys, 120);
    const frames = Math.round(ALLOC_SECONDS / STEP);
    const bytesPerFrame = untilQuiet(() => allocatedBytes(() => run(sys, ALLOC_SECONDS)) / frames, BOUND_B);
    assert.ok(bytesPerFrame <= BOUND_B, `${bytesPerFrame.toFixed(1)} B a frame over ${frames} frames of eight running jets, over ${BOUND_B} B`);
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

/** A row lit while a car came in: its index (0 = the line's or the lip's), the metres still to it, and the fountain-clock second it lit. */
type Lit = { row: number; toGo: number; at: number };

/** The owner's floor between two consecutive rows (m), stated here, not read back from the plan. */
const OWNER_MIN_GAP = 10;
/** The race rows' spacing Main agreed (m), stated here. */
const OWNER_RACE_GAP = 30;
/** How near (m) the High jump's and Ring Fling's back row stands to the car's spawn: "closer to spawn position for start". */
const NEAR_SPAWN = 20;
const RACE_SPEED = 40;

/** Rows the race director has been asked to place (`roadsideAt`'s `behind`), in the order asked: one pair, two asks, per row. */
function raceRows(asked: readonly { behind: number }[]): number[] {
  return asked.filter((_, i) => i % 2 === 0).map((a) => Math.round(a.behind / RACE_ROW_GAP));
}

/** A car runs in at `speed` m/s from `from` m out to past the line, a frame at a time: the rows lit, in order. */
function raceApproach(f: Fountains, from: number, speed: number): Lit[] {
  let left = from;
  let at = 0;
  const { race, asked } = standIn(() => left);
  const lit: Lit[] = [];
  for (; left > -5; left -= speed * STEP, at += STEP) {
    const before = asked.length;
    f.raceFrame(race, 0, speed);
    for (const row of raceRows(asked.slice(before))) lit.push({ row, toGo: left - row * RACE_ROW_GAP, at });
    f.update(STEP);
  }
  return lit;
}

/** Seconds between each light and the next, in the order lit. */
const spacings = (lit: readonly Lit[]): number[] => lit.slice(1).map((l, i) => l.at - lit[i]!.at);

describe("given a race on its last lap", () => {
  const fromFar = (): number => 4 * RACE_ROW_GAP + RACE_SPEED * APPROACH_LEAD_S;

  for (const tier of TIERS) {
    it(`when the car runs in to the line at ${tier}, then ${RACE_JETS[tier]} jets stand, a pair per row`, () => {
      const f = fountains(tier);
      raceApproach(f, fromFar(), RACE_SPEED);
      assert.equal(f.jets.jets, RACE_JETS[tier]);
    });
  }

  it("when the car is on an earlier lap, then no jet starts however near the line it is", () => {
    const f = fountains("ultra");
    f.raceFrame(standIn(() => NaN).race, 0, RACE_SPEED);
    assert.equal(f.jets.jets, 0);
  });

  it("when the car closes on the line, then the rows stand 30 m apart and light back to front, each as the car comes its lead from it, before it passes", () => {
    const lit = raceApproach(fountains("ultra"), fromFar(), RACE_SPEED);
    assert.equal(lit.map((l) => l.row).join(), "3,2,1,0", "back to front, the line's pair last");
    assert.ok(RACE_ROW_GAP >= OWNER_RACE_GAP && OWNER_RACE_GAP >= OWNER_MIN_GAP, `rows ${RACE_ROW_GAP} m apart`);
    const reach = RACE_SPEED * APPROACH_LEAD_S;
    for (const l of lit) assert.ok(l.toGo >= 0 && l.toGo <= reach && l.toGo > reach - RACE_SPEED * STEP - 1e-6, `row ${l.row} lit ${l.toGo.toFixed(1)} m out`);
    assert.ok(spacings(lit).every((s) => s >= ROW_STAGGER_S), `light gaps ${spacings(lit).map((s) => s.toFixed(2)).join(", ")} s`);
  });

  it("when every row is within the lead at once (a fast car), then they still light one after another, ROW_STAGGER_S apart at least", () => {
    const lit = raceApproach(fountains("ultra"), 2 * RACE_ROW_GAP + 1, 60);
    assert.equal(lit.map((l) => l.row).join(), "2,1,0");
    assert.ok(spacings(lit).every((s) => s >= ROW_STAGGER_S - 1e-9), `light gaps ${spacings(lit).map((s) => s.toFixed(2)).join(", ")} s`);
  });

  it("when the jets are placed, then one stands each side of the road, outside its wall", () => {
    const f = fountains("ultra");
    const { race, asked } = standIn(() => 0);
    f.raceFrame(race, 0, RACE_SPEED);
    assert.equal(asked.map((a) => a.side).join(), "-1,1");
    assert.ok(asked.every((a) => a.margin === ROAD_MARGIN && a.behind === 0));
  });

  it("when the car is slow, then the show waits for it: a car at 0 m/s is timed at the floor speed, not at infinity", () => {
    const f = fountains("ultra");
    f.raceFrame(standIn(() => 150).race, 0, 0);
    assert.equal(f.jets.jets, 0, "150 m from the line at a standstill");
    f.raceFrame(standIn(() => 10).race, 0, 0);
    assert.equal(f.jets.jets, 2, "10 m from the line: the line's pair; the rows back down the run-in are behind the car");
  });

  it("when the car is across the line, then nothing starts", () => {
    const f = fountains("ultra");
    f.raceFrame(standIn(() => -1).race, 0, RACE_SPEED);
    assert.equal(f.jets.jets, 0);
  });

  it("when the rows have started, then they never start again that race, and a new run re-arms them", () => {
    const f = fountains("high");
    assert.equal(raceApproach(f, fromFar(), RACE_SPEED).length, 3);
    assert.equal(raceApproach(f, fromFar(), RACE_SPEED).length, 0, "no second start");
    f.reset();
    assert.equal(f.jets.jets, 0, "the reset stops the jets");
    assert.equal(raceApproach(f, fromFar(), RACE_SPEED).length, 3, "the new run's last lap starts them again");
  });

  it("when the jets start, then each runs the lead, the arrival and the seconds after it, the line's pair the bigger", () => {
    const f = fountains("ultra");
    f.raceFrame(standIn(() => 0).race, 0, RACE_SPEED);
    assert.ok(f.jets["run"].some((run) => Math.abs(run - APPROACH_RUN_S) < 1e-4), `a jet runs ${APPROACH_RUN_S} s`);
    assert.ok([...f.jets["power"]].slice(0, 2).every((p) => Math.abs(p - LINE_POWER) < 0.01), "the line's pair throws at LINE_POWER");
    assert.ok(LINE_POWER > ROW_POWER);
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

const RUN_UP_MODES: readonly (MinigameMode | null)[] = [null, ...MINIGAME_MODES];
const modeName = (mode: MinigameMode | null): string => mode ?? "plain Range";
/** World x of the lip (the barrier's, in the Long jump) of `mode`; the plain Range's wall is the origin. */
const lipX = (mode: MinigameMode | null): number => (mode === null ? 0 : STATION_ANCHORS[mode].x);
/** World x the car of `mode` starts from. */
const spawnX = (mode: MinigameMode | null): number => (mode === null ? -RANGE.run : STATION_ANCHORS[mode].x + stationStartPose(mode).x);
/** The plain Range's car is spawned at `RANGE.kph`; a minigame's pulls away from a standstill at about this (m/s², m/s). */
const PULL_AWAY = 6;
const TOP_SPEED = 30;
const RANGE_SPAWN_SPEED = RANGE.kph / KPH_PER_MS;

/** The jets standing, with where: world x, y, z of each. */
function standing(f: Fountains): { x: number; y: number; z: number }[] {
  return Array.from({ length: JET_SLOTS }, (_, s) => s)
    .filter((s) => f.jets["run"][s]! > 0)
    .map((s) => ({ x: f.jets["jx"][s]!, y: f.jets["jy"][s]!, z: f.jets["jz"][s]! }));
}

/** The rows' x, lip first, as they stand once lit. */
function rowXs(f: Fountains): number[] {
  return [...new Set(standing(f).map((j) => j.x))].sort((a, b) => b - a);
}

/** The car of `mode` from its spawn to past the lip, a frame at a time: the rows that started, in order (row 0 the lip's). */
function runUp(f: Fountains, mode: MinigameMode | null): Lit[] {
  const lip = lipX(mode);
  const gap = mode === null ? RANGE_ROW_GAP : STATION_ROW_GAP[mode];
  let x = spawnX(mode);
  let v = mode === null ? RANGE_SPAWN_SPEED : 0;
  const lit: Lit[] = [];
  for (let at = 0; x < lip + 1; at += STEP) {
    const before = f["started"];
    f.runUpFrame(mode, x, v);
    for (let row = RUNUP_ROWS - 1; row >= 0; row--) if (f["started"] & ~before & (1 << row)) lit.push({ row, toGo: lip - row * gap - x, at });
    f.update(STEP);
    if (mode !== null) v = Math.min(TOP_SPEED, v + PULL_AWAY * STEP);
    x += v * STEP;
  }
  return lit;
}

describe("given the Range's car on its run-up", () => {
  for (const tier of TIERS) {
    it(`when the car runs up at ${tier}, then ${RANGE_JETS[tier]} jets stand, two to a row`, () => {
      const f = fountains(tier);
      runUp(f, MINIGAME_MODE.highJump);
      assert.equal(f.jets.jets, RANGE_JETS[tier]);
    });
  }

  for (const mode of RUN_UP_MODES) {
    it(`when the car runs up at ultra (${modeName(mode)}), then three rows stand evenly spread from the lip back, at least 10 m apart, on both edges, none past the lip`, () => {
      const f = fountains("ultra");
      runUp(f, mode);
      assertRows(f, mode);
    });
  }

  for (const mode of [MINIGAME_MODE.highJump, MINIGAME_MODE.ringFling]) {
    it(`when the ${mode} rows stand, then the back row is near the car's spawn: the rows spread down the whole run-up`, () => {
      const f = fountains("ultra");
      runUp(f, mode);
      const back = rowXs(f).at(-1)!;
      assert.ok(back - spawnX(mode) <= NEAR_SPAWN, `the back row stands ${(back - spawnX(mode)).toFixed(1)} m ahead of the spawn`);
    });
  }

  for (const mode of RUN_UP_MODES) {
    it(`when the car comes (${modeName(mode)}), then the rows light strictly back to front, each before the car reaches it and ROW_STAGGER_S at least after the last`, () => {
      const lit = runUp(fountains("ultra"), mode);
      assert.equal(lit.map((l) => l.row).join(), "2,1,0", "back to front, the lip's pair last");
      assert.ok(lit.every((l) => l.toGo >= 0), `every row lit with the car short of it (${lit.map((l) => l.toGo.toFixed(1)).join(", ")} m)`);
      assert.ok(spacings(lit).every((s) => s >= ROW_STAGGER_S - 1e-9), `light gaps ${spacings(lit).map((s) => s.toFixed(2)).join(", ")} s`);
    });
  }

  it("when the lip's pair and a row's are compared, then the lip's is the bigger", () => {
    const f = fountains("ultra");
    runUp(f, MINIGAME_MODE.highJump);
    const slots = Array.from({ length: JET_SLOTS }, (_, s) => s).filter((s) => f.jets["run"][s]! > 0);
    const lip = slots.filter((s) => Math.abs(f.jets["jx"][s]! - lipX(MINIGAME_MODE.highJump)) < 1e-4);
    assert.equal(lip.length, 2);
    assert.ok(lip.every((s) => Math.abs(f.jets["power"][s]! - LINE_POWER) < 0.01));
    assert.ok(slots.filter((s) => !lip.includes(s)).every((s) => f.jets["power"][s] === ROW_POWER));
  });

  for (const mode of RUN_UP_MODES) {
    it(`when the car is parked at its start for two seconds (${modeName(mode)}), then nothing fires`, () => {
      const f = fountains("ultra");
      for (let i = 0; i < 2 * FRAME_HZ; i++) {
        f.runUpFrame(mode, spawnX(mode), 0);
        f.update(STEP);
      }
      assert.equal(f.jets.jets, 0);
    });
  }

  it("when the car is already past the lip, then no row starts", () => {
    for (const mode of RUN_UP_MODES) {
      const f = fountains("ultra");
      f.runUpFrame(mode, lipX(mode) + 0.5, TOP_SPEED);
      assert.equal(f.jets.jets, 0, `${modeName(mode)}: nothing starts once the car is by`);
    }
  });

  it("when the car is past the back rows but short of the lip, then only the lip's pair starts", () => {
    const f = fountains("ultra");
    f.runUpFrame(null, -RANGE_ROW_GAP / 3, TOP_SPEED);
    assert.equal(f.jets.jets, 2);
  });

  it("when the next attempt comes after a reset, then the rows fire again; without one they do not", () => {
    const f = fountains("high");
    assert.equal(runUp(f, null).length, 3);
    assert.equal(runUp(f, null).length, 0, "no second start");
    f.reset();
    assert.equal(f.jets.jets, 0);
    assert.equal(runUp(f, null).length, 3);
  });

  it("when the jets start, then each runs through the launch: the lead, the arrival and the seconds after", () => {
    const f = fountains("minimal");
    f.runUpFrame(MINIGAME_MODE.ringFling, STATION_ANCHORS.ringFling.x - 10, TOP_SPEED);
    assert.ok(f.jets["run"].some((r) => Math.abs(r - APPROACH_RUN_S) < 1e-4));
    assert.equal(f.jets["wait"].filter((wait) => wait > 0).length, 0, "they start at once");
  });
});

/** Three rows of two at `mode`'s run-up: the lip's pair at the lip, even gaps of at least `OWNER_MIN_GAP`, each jet on the lane's edge and the floor. */
function assertRows(f: Fountains, mode: MinigameMode | null): void {
  const placed = standing(f);
  const xs = rowXs(f);
  assert.equal(placed.length, 6);
  assert.equal(xs.length, 3);
  assert.ok(Math.abs(xs[0]! - lipX(mode)) < 1e-6, "the big pair at the lip");
  const gaps = [xs[0]! - xs[1]!, xs[1]! - xs[2]!];
  assert.ok(gaps.every((g) => g >= OWNER_MIN_GAP), `${modeName(mode)}: rows ${gaps.map((g) => g.toFixed(1)).join(", ")} m apart`);
  assert.ok(Math.abs(gaps[0]! - gaps[1]!) < 1e-6, "evenly spread");
  const z0 = mode === null ? 0 : STATION_ANCHORS[mode].z;
  const edge = mode === null ? RANGE.halfWidth + 1 : STATION_HALF_WIDTH;
  assert.ok(placed.every((j) => Math.abs(Math.abs(j.z - z0) - edge) < 1e-6), `every jet stands ${edge} m off the lane's middle`);
  for (const j of placed) assert.ok(Math.abs(j.y - (mode === null ? 0 : floorHeightAt(mode, j.x - lipX(mode), 0))) < 1e-4, `a jet stands on the floor under it (y ${j.y})`);
}
