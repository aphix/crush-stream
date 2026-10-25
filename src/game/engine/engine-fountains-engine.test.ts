import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import * as THREE from "three";
import "../kernel/rapier-node.test-util.ts";
import { HudStore } from "../hud/hud-store.ts";
import { FRAME_HZ } from "../kernel/constants.ts";
import { JET_SLOTS } from "../present/fountain-system.ts";
import { sparkLives } from "../present/fountain-sparks.test-util.ts";
import { RACE_ROW_GAP, ROAD_MARGIN, STATION_ROW_GAP } from "../present/fountain-plan.ts";
import { MINIGAME_MODES, STATION_ANCHORS, STATION_HALF_WIDTH } from "../scenes/minigame-constants.ts";
import { RANGE } from "../scenes/range.ts";
import { blankPoint, pointOn } from "../world/track.ts";
import { setGround } from "../world/ground.ts";
import { CrashEngine } from "./engine.ts";
import { element, stubBrowser } from "./engine-headless.test-util.ts";

/**
 * The celebration fountains in the real engine: the Range's car (plain, and in each minigame) is led up its run-up to the lip by rows that
 * light as it comes and burn through the throw, a race's last lap lights the finish line's as the car nears it, and the race
 * director's two readings (the metres left on the last lap, the road's edge at a distance back from the line) answer for a real course.
 */

const FRAME = 1 / FRAME_HZ;
const LAPS = 2;
/** Seconds of sim a Range launch may take from the engine's start (the attract run throws within the loop's first seconds). */
const LAUNCH_TIMEOUT_S = 20;
/** Sim seconds a full-throttle minigame run may take from the pedal to the throw (the slowest, the Ring Fling hill, takes well under this). */
const MINIGAME_DRIVE_TIMEOUT_S = 60;

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
    const launches: number[] = [];
    before(() => {
      const ragdolls = engine["ragdolls"];
      const launch = ragdolls.launch.bind(ragdolls);
      ragdolls.launch = (e, cars, rides, releaseScale) => {
        launches.push(launches.length);
        launch(e, cars, rides, releaseScale);
      };
    });

    it("when the plain Range's car runs up to the barrier, then the rows stand along both sides of the run-up before the throw, none past the barrier, and the loop's reset clears them", () => {
      engine["setScene"]("range");
      launches.length = 0;
      for (let frame = 0; frame < LAUNCH_TIMEOUT_S * FRAME_HZ && fountains().jets.jets < 6 && launches.length === 0; frame++) advance(1);
      assert.equal(launches.length, 0, "before the throw: the run-up's fountains lead the car in");
      const edge = RANGE.halfWidth + 1;
      const placed = jetsAt();
      assert.equal(placed.length, 6, "three rows of two at the high tier, all lit before the throw");
      assert.equal(new Set(placed.map((j) => j.z)).size, 2, "a jet on each side");
      assert.ok(placed.every((j) => Math.abs(Math.abs(j.z) - edge) < 1e-6), "each stands on the field's edge");
      assert.ok(placed.every((j) => j.x <= 0), "none past the barrier");
      for (let frame = 0; frame < LAUNCH_TIMEOUT_S * FRAME_HZ && launches.length === 0; frame++) advance(1);
      assert.equal(launches.length, 1, "the driver was thrown");
      assert.equal(fountains().jets.jets, 6, "the jets keep going through the launch");
      advance(FRAME_HZ);
      assert.ok(sparkLives(fountains().jets).some((life) => life > 0), "sparks are in the air while the dummy flies");
      engine["clearLocal"]();
      assert.equal(fountains().jets.jets, 0, "a reset stops the jets");
      assert.ok(sparkLives(fountains().jets).every((life) => life <= 0), "and clears their sparks");
    });

    for (const mode of MINIGAME_MODES) {
      it(`when the ${mode} car is driven at the lip, then nothing fires while it stands parked, the rows light on the ramp back to front as it comes, and the throw finds all three rows burning`, () => {
        launches.length = 0;
        engine.startMinigame(mode);
        advance(FRAME_HZ);
        assert.equal(fountains().jets.jets, 0, "parked at the start: nothing");
        const lip = STATION_ANCHORS[mode];
        const lit: number[] = [];
        engine["keys"].add("KeyW");
        for (let frame = 0; frame < MINIGAME_DRIVE_TIMEOUT_S * FRAME_HZ && launches.length === 0; frame++) {
          advance(1);
          for (const j of jetsAt()) {
            const row = Math.round((lip.x - j.x) / STATION_ROW_GAP[mode]);
            if (!lit.includes(row)) lit.push(row);
            assert.ok(j.x <= lip.x + 1e-6, `${mode}: a jet stands past the lip`);
            assert.ok(Math.abs(Math.abs(j.z - lip.z) - STATION_HALF_WIDTH) < 1e-6, `${mode}: a jet stands off the ramp's edge`);
          }
        }
        engine["keys"].delete("KeyW");
        assert.equal(launches.length, 1, `${mode}: the driver was thrown`);
        assert.deepEqual(lit, [2, 1, 0], `${mode}: back row first, the lip's pair last, all before the throw`);
        assert.equal(fountains().jets.jets, 6, `${mode}: three rows burn through the launch`);
      });
    }
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

    it("when a row is placed back from the line, then its pair stands either side of the road's centre that far before the line along the course, the first at the line", () => {
      const track = session().track;
      const left = new THREE.Vector3();
      const right = new THREE.Vector3();
      for (const k of [0, 1, 2, 3]) {
        assert.ok(director().roadsideAt(k * RACE_ROW_GAP, 1, ROAD_MARGIN, left) && director().roadsideAt(k * RACE_ROW_GAP, -1, ROAD_MARGIN, right));
        const centre = pointOn(track.path, track.length - k * RACE_ROW_GAP, blankPoint());
        const off = Math.hypot((left.x + right.x) / 2 - centre.x, (left.z + right.z) / 2 - centre.z);
        assert.ok(off < 1e-6, `row ${k}: its pair is centred on the road ${k * RACE_ROW_GAP} m before the line (${off.toFixed(3)} m off)`);
      }
    });

    it("when the player nears the line on the last lap, then the rows light back to front before the line, the line's pair last, and none starts once he is across; on an earlier lap nothing does", () => {
      fountains().reset();
      director().lastLapLeft = () => NaN;
      advance(2);
      assert.equal(fountains().jets.jets, 0, "an earlier lap: no jets");
      const track = session().track;
      const g = track.gates[0]!;
      const cx = (g.ax + g.bx) / 2;
      const cz = (g.az + g.bz) / 2;
      /** Metres the jet stands before the line along the way the cars drive (negative: before it). */
      const along = (x: number, z: number): number => (x - cx) * g.nx + (z - cz) * g.nz;
      let left = 4 * RACE_ROW_GAP;
      director().lastLapLeft = () => left;
      const lit: number[] = [];
      const lastLit: number[] = [];
      for (; left > -10; left -= 1) {
        advance(1);
        for (const j of jetsAt()) {
          const row = Math.round(Math.abs(along(j.x, j.z)) / RACE_ROW_GAP);
          assert.ok(along(j.x, j.z) <= 0.05, `a jet stands ${along(j.x, j.z).toFixed(2)} m past the line`);
          if (!lit.includes(row)) {
            lit.push(row);
            lastLit.push(left);
          }
        }
      }
      assert.deepEqual(lit, [2, 1, 0], "the farthest row first, the line's pair last");
      assert.ok(lastLit.every((at) => at > 0), `every row lit while the car was still short of the line (at ${lastLit.join(", ")} m to go)`);
      assert.equal(jetsAt().length, 6, "three rows of two at the high tier");
    });
  });
});
