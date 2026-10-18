import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import * as THREE from "three";
import "../kernel/rapier-node.test-util.ts";
import { HudStore } from "../hud/hud-store.ts";
import { FRAME_HZ } from "../kernel/constants.ts";
import { JET_SLOTS } from "../present/engine-fx.ts";
import { rangeEdge } from "../present/fountain-plan.ts";
import { blankPoint, pointOn } from "../world/track.ts";
import { setGround } from "../world/ground.ts";
import { CrashEngine } from "./engine.ts";
import { element, stubBrowser } from "./engine-headless.test-util.ts";

/**
 * The celebration fountains in the real engine: the Range's launch lights the rows, a race's last lap lights the finish line's as the
 * car nears it, and the race director's two readings (the metres left on the last lap, the road's edge at a distance back from the
 * line) answer for a real course.
 */

const FRAME = 1 / FRAME_HZ;
const LAPS = 2;
/** Seconds of sim a Range launch may take from the engine's start (the attract run throws within the loop's first seconds). */
const LAUNCH_TIMEOUT_S = 20;

describe("given the real engine", () => {
  // One engine for the file: a second `CrashEngine` in the same process never resolves `ready`.
  let engine: CrashEngine;
  const advance = (frames: number): void => {
    for (let i = 0; i < frames; i++) engine.advance(FRAME, { frameDt: FRAME });
  };
  const fountains = () => engine["fountains"];
  const jetsAt = (): { x: number; z: number }[] =>
    Array.from({ length: JET_SLOTS }, (_, s) => s)
      .filter((s) => fountains().jets["run"][s]! > 0)
      .map((s) => ({ x: fountains().jets["jx"][s]!, z: fountains().jets["jz"][s]! }));

  before(async () => {
    setGround(null);
    stubBrowser();
    globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} } as unknown as Storage;
    engine = new CrashEngine(element(), new HudStore(), element());
    Object.assign(engine["renderer"], { render() {}, compile() {}, compileAsync: () => Promise.resolve() });
    await engine.ready;
    for (let wait = 0; wait < 200 && engine["ragdolls"]["world"] === null; wait++) await delay(50);
    engine.fadeScenes = false;
    let tick = 0;
    Object.assign(engine.pace, { now: () => (tick += 0.001) });
    // The high tier as the fountains read it: the engine's own tier would load the sky (a failed fetch in node, stderr), and Auto moves it.
    const look = fountains().setLook.bind(fountains());
    fountains().setLook = (_tier, density) => look("high", density);
  });
  after(() => {
    engine.dispose();
    setGround(null);
  });

  describe("given the Range", () => {
    it("when the car meets the barrier and its driver is thrown, then three rows of jets stand along the field's edges, sparks fly, and the loop's reset clears them", () => {
      engine["setScene"]("range");
      let thrown = false;
      const rangeThrow = fountains().rangeThrow.bind(fountains());
      fountains().rangeThrow = (mode) => {
        thrown = true;
        rangeThrow(mode);
      };
      for (let frame = 0; frame < LAUNCH_TIMEOUT_S * FRAME_HZ && !thrown; frame++) advance(1);
      assert.ok(thrown, "the launch lit the fountains");
      const edge = rangeEdge(null);
      const placed = jetsAt();
      assert.equal(placed.length, 6, "three rows of two at the high tier");
      assert.equal(JSON.stringify([...new Set(placed.map((j) => j.z))].sort((a, b) => a - b)), JSON.stringify([-edge, edge]));
      advance(3 * FRAME_HZ);
      assert.ok(fountains().jets["life"].some((life) => life > 0), "sparks are in the air while the dummy flies");
      engine["clearLocal"]();
      assert.equal(fountains().jets.jets, 0, "a reset stops the jets");
      assert.ok(fountains().jets["life"].every((life) => life <= 0), "and clears their sparks");
    });
  });

  describe("given a two-lap race", () => {
    const director = () => engine["race"];
    const session = () => director()["session"]!;
    /** The player's record, and the course's length (m). */
    const me = () => session().cars[director()["rowOf"][director().self]!]!;

    before(() => {
      engine.toggleRace();
      engine.raceCommand({ type: "options", options: { trackId: "oval", aiCount: 1, laps: LAPS, police: false, campaign: ["oval", "rally"] } });
      engine.raceCommand({ type: "start" });
    });

    it("when the rules read the lap the player is on, then only a racing car on the lap that ends the race has metres left", () => {
      const s = session();
      const L = s.track.length;
      s.phase = "racing";
      const c = me();
      Object.assign(c, { status: "racing", armed: true, lap: LAPS - 1, progress: LAPS * L - 123.5 });
      assert.ok(Math.abs(director().lastLapLeft(director().self) - 123.5) < 1e-6, "the last lap: the race's distance less the car's");
      c.lap = LAPS - 2;
      assert.ok(Number.isNaN(director().lastLapLeft(director().self)), "an earlier lap");
      c.lap = LAPS - 1;
      c.armed = false;
      assert.ok(Number.isNaN(director().lastLapLeft(director().self)), "the grid, behind the line");
      c.armed = true;
      c.status = "out";
      assert.ok(Number.isNaN(director().lastLapLeft(director().self)), "a car out of the race");
      c.status = "racing";
      s.phase = "countdown";
      assert.ok(Number.isNaN(director().lastLapLeft(director().self)), "before the green light");
      s.phase = "finished";
      assert.ok(Number.isNaN(director().lastLapLeft(director().self)), "once the race is over");
      s.phase = "racing";
      assert.ok(Number.isNaN(director().lastLapLeft(director()["entrants"].length)), "a car that is no racer");
    });

    it("when the road's two edges are asked for at a distance before the line, then they are mirrored about the road and the margin outside it", () => {
      const track = session().track;
      const centre = pointOn(track.path, track.length - 44, blankPoint());
      const left = new THREE.Vector3();
      const right = new THREE.Vector3();
      assert.ok(director().roadsideAt(44, 1, 2, left) && director().roadsideAt(44, -1, 2, right), "the course is loaded");
      assert.ok(Math.abs((left.x + right.x) / 2 - centre.x) < 1e-6 && Math.abs((left.z + right.z) / 2 - centre.z) < 1e-6, "the pair is centred on the road");
      const apart = Math.hypot(left.x - right.x, left.z - right.z);
      assert.ok(Math.abs(apart - 2 * (centre.half + 2)) < 1e-6, `${apart.toFixed(2)} m apart: the road's width and a margin each side`);
    });

    it("when the player nears the line on the last lap, then the frame lights the finish line's rows; on an earlier lap it does not", () => {
      fountains().reset();
      director().lastLapLeft = () => NaN;
      advance(2);
      assert.equal(fountains().jets.jets, 0, "an earlier lap: no jets");
      director().lastLapLeft = () => 10;
      advance(2);
      assert.equal(fountains().jets.jets, 6, "last lap, 10 m out: every row of the high tier is due");
      assert.equal(jetsAt().length, 6);
    });
  });
});
