import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { setImmediate as yieldToLoop } from "node:timers/promises";
import { PerformanceObserver } from "node:perf_hooks";
import * as THREE from "three";
import { GRAVITY } from "../kernel/constants.ts";
import { FountainSystem, JET_FADE_S, JET_RATE, JET_SLOTS, JET_UP_MAX } from "../present/engine-fx.ts";
import type { FxTier } from "../present/engine-post.ts";
import { FOUNTAIN_TIER, LINE_POWER, RACE_LEAD_S, RACE_RUN_S, RANGE_ROWS, RANGE_STAGGER_S, ROAD_MARGIN, ROW_GAP, rangeEdge, rangeRowX } from "../present/fountain-plan.ts";
import { RANGE } from "../scenes/range.ts";
import { MINIGAME_MODE, STATION_ANCHORS } from "../scenes/minigame-constants.ts";
import { Fountains } from "./engine-fountains.ts";
import type { RaceField } from "./engine-race-field.ts";

/**
 * The celebration fountains without an engine: the jet pool's timing, count, arc and fade, then the two triggers (the race's last-lap
 * run-in, the Range's launch) against a stand-in race. The real engine's wiring is `engine-fountains-engine.test.ts`.
 */

// The fx pools paint their dot sprites on a canvas; the headless run lends them one that takes any draw.
const ctx = { createRadialGradient: () => ({ addColorStop() {} }), fillRect() {}, fillStyle: "" };
const CANVAS = { createElement: () => ({ width: 0, height: 0, getContext: () => ctx }) };

const STEP = 1 / 60;
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

  it("when a power 1.7 jet runs beside a plain one, then it throws 1.7 times the sparks", () => {
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
    for (let i = 0; i < Math.round(5 / STEP); i++) {
      sys.update(STEP);
      for (let k = 0; k < sys["n"]; k++) {
        if (sys["life"][k]! <= 0) continue;
        top = Math.max(top, sys["pos"][k * 3 + 1]!);
        low = Math.min(low, sys["pos"][k * 3 + 1]!);
      }
    }
    assert.ok(top > nozzleY + 3 && top <= apex + 0.1, `the highest spark reached ${top.toFixed(2)} m, the arc's apex is ${apex.toFixed(2)} m`);
    assert.ok(low >= nozzleY - 0.2, `a spark fell to ${low.toFixed(2)} m below the nozzle`);
    assert.equal(alive(sys), 0, "every spark has landed");
    assert.equal(sys.jets, 0, "the jet is spent");
  });

  it("when sparks are in the air, then each fades to nothing over its last JET_FADE_S and is full before", () => {
    const sys = pool();
    sys.jet(0, 0, 0, 0, 1);
    run(sys, 1.5);
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
    assert.ok(fading > 0 && full > 0, `${fading} fading, ${full} full: both must exist at 1.5 s`);
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
    run(sys, 3);
    const watch = new PerformanceObserver(() => {});
    watch.observe({ entryTypes: ["gc"] });
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
  const dueAt = (k: number): number => k * ROW_GAP + SPEED * RACE_LEAD_S;

  for (const tier of TIERS) {
    it(`when the car reaches the line at ${tier}, then ${RACE_JETS[tier]} jets stand, a pair per row`, () => {
      const f = fountains(tier);
      f.raceFrame(standIn(() => 0).race, 0, SPEED);
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
    assert.deepEqual(
      asked.map((a) => a.behind),
      [3, 3, 2, 2, 1, 1, 0, 0].map((k) => k * ROW_GAP),
    );
    assert.deepEqual(
      asked.map((a) => a.side),
      [-1, 1, -1, 1, -1, 1, -1, 1],
      "one jet each side of the road",
    );
    assert.ok(asked.every((a) => a.margin === ROAD_MARGIN));
  });

  it("when the car is slow, then the show waits for it: a car at 0 m/s is timed at the floor speed, not at infinity", () => {
    const f = fountains("ultra");
    f.raceFrame(standIn(() => 150).race, 0, 0);
    assert.equal(f.jets.jets, 0, "150 m from the line at a standstill");
    f.raceFrame(standIn(() => 10).race, 0, 0);
    assert.equal(f.jets.jets, 8, "10 m from the line, every row's turn has come");
  });

  it("when the rows have started, then they never start again that race, and a new run re-arms them", () => {
    const f = fountains("high");
    const { race, asked } = standIn(() => 0);
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
    assert.ok(f.jets["run"].some((run) => Math.abs(run - RACE_RUN_S) < 1e-4), `a jet runs ${RACE_RUN_S} s`);
    assert.equal(f.jets["wait"].filter((wait) => wait > 0).length, 0, "they start at once");
  });

  it("when the line's pair and a row's are compared, then the line's is the bigger", () => {
    const f = fountains("ultra");
    f.raceFrame(standIn(() => 0).race, 0, SPEED);
    const powers = [...f.jets["power"]].slice(0, 8);
    assert.deepEqual(powers.slice(0, 2).map((p) => Math.round(p * 10) / 10), [LINE_POWER, LINE_POWER]);
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

describe("given the Range's ragdoll launched", () => {
  const jets = (f: Fountains): { x: number; z: number; wait: number }[] =>
    Array.from({ length: JET_SLOTS }, (_, s) => s)
      .filter((s) => f.jets["run"][s]! > 0)
      .map((s) => ({ x: f.jets["jx"][s]!, z: f.jets["jz"][s]!, wait: f.jets["wait"][s]! }));

  for (const tier of TIERS) {
    it(`when it flies at ${tier}, then ${RANGE_JETS[tier]} jets stand, two to a row`, () => {
      const f = fountains(tier);
      f.rangeThrow(null);
      assert.equal(f.jets.jets, RANGE_JETS[tier]);
    });
  }

  it("when it flies at ultra, then the rows stand evenly down the field, a jet each edge of it, each row a beat after the last", () => {
    const f = fountains("ultra");
    f.rangeThrow(null);
    const placed = jets(f);
    const edge = rangeEdge(null);
    assert.equal(edge, RANGE.halfWidth + 1);
    for (let row = 0; row < RANGE_ROWS; row++) {
      const pair = placed.filter((j) => Math.abs(j.x - rangeRowX(row, RANGE_ROWS)) < 1e-3);
      assert.deepEqual(pair.map((j) => j.z).sort(), [-edge, edge], `row ${row}: one jet each edge`);
      assert.ok(pair.every((j) => Math.abs(j.wait - row * RANGE_STAGGER_S) < 1e-4), `row ${row} starts ${row * RANGE_STAGGER_S} s after the launch`);
    }
    assert.ok(placed.every((j) => j.x > 0 && j.x < RANGE.length), "the rows stand inside the field's length");
  });

  it("when it flies in a minigame, then the rows stand along that station's edges", () => {
    for (const mode of [MINIGAME_MODE.highJump, MINIGAME_MODE.ringFling]) {
      const f = fountains("high");
      f.rangeThrow(mode);
      const edge = rangeEdge(mode);
      const placed = jets(f);
      assert.equal(placed.length, 6);
      assert.deepEqual([...new Set(placed.map((j) => j.z))].sort((a, b) => a - b), [STATION_ANCHORS[mode].z - edge, STATION_ANCHORS[mode].z + edge], mode);
    }
  });

  it("when the next throw comes after a reset, then the rows fire again", () => {
    const f = fountains("high");
    f.rangeThrow(null);
    f.reset();
    assert.equal(f.jets.jets, 0);
    f.rangeThrow(null);
    assert.equal(f.jets.jets, 6);
  });
});
