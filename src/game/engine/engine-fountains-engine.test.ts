import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as THREE from "three";
import "../kernel/rapier-node.test-util.ts";
import { FRAME_HZ } from "../kernel/constants.ts";
import { JET_SLOTS } from "../present/fountain-system.ts";
import { sparkLives } from "../present/fountain-sparks.test-util.ts";
import { RACE_ROW_GAP, ROAD_MARGIN, STATION_ROW_GAP } from "../present/fountain-plan.ts";
import { MINIGAME_MODES, STATION_ANCHORS, STATION_HALF_WIDTH } from "../scenes/minigame-constants.ts";
import { RANGE } from "../scenes/range.ts";
import { blankPoint, pointOn } from "../world/track.ts";
import { setGround } from "../world/ground.ts";
import type { CrashEngine } from "./engine.ts";
import { bootEngine, stubBrowser } from "./engine-headless.test-util.ts";
import { firstMismatch } from "../kernel/compare-arrays.test-util.ts";

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

  beforeAll(async () => {
    setGround(null);
    stubBrowser();
    globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} } as unknown as Storage;
    engine = await bootEngine({ pacer: true });
    await engine["ragdolls"].preload();
    // The high tier as the fountains read it: the engine's own tier would load the sky (a failed fetch in node, stderr), and Auto moves it.
    const look = fountains().setLook.bind(fountains());
    fountains().setLook = (_tier, density) => look("high", density);
  });
  afterAll(() => {
    engine.dispose();
    setGround(null);
  });

  describe("given the Range", () => {
    const launches: number[] = [];
    beforeAll(() => {
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
      expect(launches.length, "before the throw: the run-up's fountains lead the car in").toBe(0);
      const edge = RANGE.halfWidth + 1;
      const placed = jetsAt();
      expect(placed.length, "three rows of two at the high tier, all lit before the throw").toBe(6);
      expect(new Set(placed.map((j) => j.z)).size, "a jet on each side").toBe(2);
      expect(placed.every((j) => Math.abs(Math.abs(j.z) - edge) < 1e-6), "each stands on the field's edge").toBeTruthy();
      expect(placed.every((j) => j.x <= 0), "none past the barrier").toBeTruthy();
      for (let frame = 0; frame < LAUNCH_TIMEOUT_S * FRAME_HZ && launches.length === 0; frame++) advance(1);
      expect(launches.length, "the driver was thrown").toBe(1);
      expect(fountains().jets.jets, "the jets keep going through the launch").toBe(6);
      advance(FRAME_HZ);
      expect(sparkLives(fountains().jets).some((life) => life > 0), "sparks are in the air while the dummy flies").toBeTruthy();
      engine["clearLocal"]();
      expect(fountains().jets.jets, "a reset stops the jets").toBe(0);
      expect(sparkLives(fountains().jets).every((life) => life <= 0), "and clears their sparks").toBeTruthy();
    });

    for (const mode of MINIGAME_MODES) {
      it(`when the ${mode} car is driven at the lip, then nothing fires while it stands parked, the rows light on the ramp back to front as it comes, and the throw finds all three rows burning`, () => {
        launches.length = 0;
        engine.startMinigame(mode);
        advance(FRAME_HZ);
        expect(fountains().jets.jets, "parked at the start: nothing").toBe(0);
        const lip = STATION_ANCHORS[mode];
        const lit: number[] = [];
        engine["keys"].add("KeyW");
        for (let frame = 0; frame < MINIGAME_DRIVE_TIMEOUT_S * FRAME_HZ && launches.length === 0; frame++) {
          advance(1);
          for (const j of jetsAt()) {
            const row = Math.round((lip.x - j.x) / STATION_ROW_GAP[mode]);
            if (!lit.includes(row)) lit.push(row);
            expect(j.x, `${mode}: a jet stands past the lip`).toBeLessThanOrEqual(lip.x + 1e-6);
            expect(Math.abs(Math.abs(j.z - lip.z) - STATION_HALF_WIDTH), `${mode}: a jet stands off the ramp's edge`).toBeLessThan(1e-6);
          }
        }
        engine["keys"].delete("KeyW");
        expect(launches.length, `${mode}: the driver was thrown`).toBe(1);
        expect(firstMismatch(lit, [2, 1, 0]), `${mode}: back row first, the lip's pair last, all before the throw`).toBeUndefined();
        expect(fountains().jets.jets, `${mode}: three rows burn through the launch`).toBe(6);
      });
    }
  });

  describe("given a two-lap race", () => {
    const director = () => engine["race"];
    const session = () => director()["session"]!;
    /** The player's record, and the course's length (m). */
    const me = () => session().cars[director()["rowOf"][director().self]!]!;

    beforeAll(() => {
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
      expect(Math.abs(director().lastLapLeft(director().self) - 123.5), "the last lap: the race's distance less the car's").toBeLessThan(1e-6);
      c.lap = LAPS - 2;
      expect(Number.isNaN(director().lastLapLeft(director().self)), "an earlier lap").toBeTruthy();
      c.lap = LAPS - 1;
      c.armed = false;
      expect(Number.isNaN(director().lastLapLeft(director().self)), "the grid, behind the line").toBeTruthy();
      c.armed = true;
      c.status = "out";
      expect(Number.isNaN(director().lastLapLeft(director().self)), "a car out of the race").toBeTruthy();
      c.status = "racing";
      s.phase = "countdown";
      expect(Number.isNaN(director().lastLapLeft(director().self)), "before the green light").toBeTruthy();
      s.phase = "finished";
      expect(Number.isNaN(director().lastLapLeft(director().self)), "once the race is over").toBeTruthy();
      s.phase = "racing";
      expect(Number.isNaN(director().lastLapLeft(director()["entrants"].length)), "a car that is no racer").toBeTruthy();
    });

    it("when the road's two edges are asked for at a distance before the line, then they are mirrored about the road and the margin outside it", () => {
      const track = session().track;
      const centre = pointOn(track.path, track.length - 44, blankPoint());
      const left = new THREE.Vector3();
      const right = new THREE.Vector3();
      expect(director().roadsideAt(44, 1, 2, left) && director().roadsideAt(44, -1, 2, right), "the course is loaded").toBeTruthy();
      expect(Math.abs((left.x + right.x) / 2 - centre.x) < 1e-6 && Math.abs((left.z + right.z) / 2 - centre.z) < 1e-6, "the pair is centred on the road").toBeTruthy();
      const apart = Math.hypot(left.x - right.x, left.z - right.z);
      expect(Math.abs(apart - 2 * (centre.half + 2)), `${apart.toFixed(2)} m apart: the road's width and a margin each side`).toBeLessThan(1e-6);
    });

    it("when a row is placed back from the line, then its pair stands either side of the road's centre that far before the line along the course, the first at the line", () => {
      const track = session().track;
      const left = new THREE.Vector3();
      const right = new THREE.Vector3();
      for (const k of [0, 1, 2, 3]) {
        expect(director().roadsideAt(k * RACE_ROW_GAP, 1, ROAD_MARGIN, left) && director().roadsideAt(k * RACE_ROW_GAP, -1, ROAD_MARGIN, right)).toBeTruthy();
        const centre = pointOn(track.path, track.length - k * RACE_ROW_GAP, blankPoint());
        const off = Math.hypot((left.x + right.x) / 2 - centre.x, (left.z + right.z) / 2 - centre.z);
        expect(off, `row ${k}: its pair is centred on the road ${k * RACE_ROW_GAP} m before the line (${off.toFixed(3)} m off)`).toBeLessThan(1e-6);
      }
    });

    it("when the player nears the line on the last lap, then the rows light back to front before the line, the line's pair last, and none starts once he is across; on an earlier lap nothing does", () => {
      fountains().reset();
      director().lastLapLeft = () => NaN;
      advance(2);
      expect(fountains().jets.jets, "an earlier lap: no jets").toBe(0);
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
          expect(along(j.x, j.z), `a jet stands ${along(j.x, j.z).toFixed(2)} m past the line`).toBeLessThanOrEqual(0.05);
          if (!lit.includes(row)) {
            lit.push(row);
            lastLit.push(left);
          }
        }
      }
      expect(firstMismatch(lit, [2, 1, 0]), "the farthest row first, the line's pair last").toBeUndefined();
      expect(lastLit.every((at) => at > 0), `every row lit while the car was still short of the line (at ${lastLit.join(", ")} m to go)`).toBeTruthy();
      expect(jetsAt().length, "three rows of two at the high tier").toBe(6);
    });
  });
});
