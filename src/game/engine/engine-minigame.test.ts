import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as THREE from "three";
import "../kernel/rapier-node.test-util.ts";
import { RANGE_LIP_ART } from "../present/range-art.ts";
import { HudStore } from "../hud/hud-store.ts";
import { FRAME_HZ } from "../kernel/constants.ts";
import { MINIGAME_AIM_LEAD } from "../present/ride-cam.ts";
import { BOX_POSE_FLOATS, type ReleaseScale } from "../present/ragdoll-boxes.ts";
import { DISC_RADIUS, activeGround, setGround, type Ground } from "../world/ground.ts";
import { MINIGAME_MODES, REST_HOLD, STATION_ANCHORS, THROW_BOOST, type MinigameMode } from "../scenes/minigame-constants.ts";
import { BOX_COUNT, HighJumpPeak, type TorsoSample } from "../scenes/minigame-high-jump.ts";
import { DRIVER_CARS } from "../match/types.ts";
import { lipHeight } from "../scenes/minigame-profile.ts";
import { ringScore } from "../scenes/minigame-ring.ts";
import { MinigameSession, type MinigameHudState } from "../scenes/minigame-session.ts";
import { BAIL_WINDOW_SECONDS, bailRelease, type BailVerdict } from "../scenes/minigame-bail.ts";
import type { CrashEngine } from "./engine.ts";
import { runSeconds, bootEngine, stubBrowser } from "./engine-headless.test-util.ts";
import { minigameStore } from "./minigame-store.ts";
import { BARRIER_HALF } from "../contact/sat.ts";

/**
 * The Range's minigames in the real engine: each mode's start, throw, score and Retry, the dummy and camera held with no timer, the
 * best kept across a reload, and the attract range left exactly as it was (and back again after Exit).
 */

const FRAME = 1 / FRAME_HZ;
const THROTTLE_KEY = "KeyW";
/** Sim seconds a throw may take from the pedal to rest, and the wait the held dummy must outlast. */
const THROW_TIMEOUT_S = 60;
const HOLD_CHECK_S = 60;
const IDLE_WAIT_S = 3;
const START_TOLERANCE = 0.05;
/** The parked car shows within this share of the frame's half-size from its middle, and the eye stands within this many metres of it. */
const PARKED_CAR_FRAME_LIMIT = 0.5;
const PARKED_CAR_EYE_DISTANCE_LIMIT = 30;
/** A full-throttle long jump with no bail rests between these (m): mid-field, half a perfect bail's range; the landing is about 47-57 m and a 30 degree throw rests within a few metres of it. */
const LONG_JUMP_NO_BAIL_MINIMUM = 40;
const LONG_JUMP_NO_BAIL_MAXIMUM = 70;
/** Sim seconds a full-throttle long jump takes from the pedal to past the barrier and down on the field. */
const LONG_JUMP_PAST_S = 8;
/** The driver cars the long jump throws: the monster flies its barrier and lands past it, its driver in (`minigame-profile.test.ts`). */
const LONG_JUMP_CARS = DRIVER_CARS.filter((type) => type.id !== "monster");
/** The eye of the parked-start shot: at least this far behind the car, at most this far off its line, looking this closely along its heading (cosine). */
const PARKED_EYE_BEHIND_MIN = 4;
const PARKED_EYE_ASIDE_MAX = 2;
const PARKED_EYE_LOOKING_MIN = 0.8;
const WHEEL_STEP = 100;
/** Sim seconds the ride camera is given to arrive on a dummy just thrown. */
const RIDE_SETTLE_S = 1;

/** An in-memory `localStorage`, the browser's key/value store. */
function memoryStorage(): Storage {
  const entries = new Map<string, string>();
  return {
    get length() {
      return entries.size;
    },
    clear: () => entries.clear(),
    getItem: (key) => entries.get(key) ?? null,
    key: (index) => [...entries.keys()][index] ?? null,
    removeItem: (key) => void entries.delete(key),
    setItem: (key, value) => void entries.set(key, value),
  };
}

type Launch = { releaseScale: ReleaseScale | undefined };

describe("given the real engine on the Range, with a spy on every dummy launch", () => {
  // One engine for the file: a second `CrashEngine` in the same process never resolves `ready`.
  let engine: CrashEngine;
  let hud: HudStore;
  /** The ground the attract Range plays on, read before any minigame. */
  let attractGround: Ground;
  const launches: Launch[] = [];
  const minigameHud = () => engine["minigames"].hud();
  const releaseThrottle = (): void => {
    engine["keys"].delete(THROTTLE_KEY);
    runSeconds(engine, 2 * FRAME);
  };
  const stationLocal = (mode: MinigameMode, world: THREE.Vector3, still: number): TorsoSample => ({ x: world.x - STATION_ANCHORS[mode].x, y: world.y, z: world.z - STATION_ANCHORS[mode].z, still });
  /** The player holds the throttle to the lip (or the barrier) and every frame's torso is read, until the throw scores or the sim runs out. */
  const throwAndRead = (mode: MinigameMode): TorsoSample[] => {
    const samples: TorsoSample[] = [];
    const torso = new THREE.Vector3();
    engine["keys"].add(THROTTLE_KEY);
    for (let frame = 0; frame < THROW_TIMEOUT_S * FRAME_HZ && minigameHud().phase !== "scored"; frame++) {
      engine.advance(FRAME, { frameDt: FRAME });
      const still = engine["ragdolls"].latest(torso);
      if (still >= 0) samples.push(stationLocal(mode, torso, still));
    }
    releaseThrottle();
    return samples;
  };
  /** The mode's score of a throw's torso samples, worked out here from the model's own pieces (the first at-rest sample; the high jump's highest point up to it). */
  const expectedScore = (mode: MinigameMode, samples: readonly TorsoSample[]): number => {
    const restAt = samples.findIndex((sample) => sample.still >= REST_HOLD);
    expect(restAt, "the dummy came to rest").toBeGreaterThanOrEqual(0);
    const atRest = samples[restAt]!;
    if (mode === "highJump") {
      const peak = new HighJumpPeak();
      const { postsX } = engine["minigames"]["highJump"];
      for (const sample of samples.slice(0, restAt + 1)) peak.step(sample, postsX, lipHeight("highJump"));
      return peak.height;
    }
    return mode === "longJump" ? Math.max(0, atRest.x) : ringScore(atRest.x, atRest.z);
  };

  beforeAll(async () => {
    stubBrowser();
    Object.defineProperty(globalThis, "localStorage", { value: memoryStorage(), configurable: true, writable: true });
    hud = new HudStore();
    engine = await bootEngine({ hud, pacer: true });
    await engine["ragdolls"].preload();
    const ragdolls = engine["ragdolls"];
    const launch = ragdolls.launch.bind(ragdolls);
    ragdolls.launch = (e, cars, rides, releaseScale) => {
      launches.push({ releaseScale });
      launch(e, cars, rides, releaseScale);
    };
    engine["setScene"]("range");
  });
  afterAll(() => {
    engine.dispose();
    setGround(null);
  });

  describe("given the attract Range before any minigame", () => {

    it("when it runs, then it is the auto-looping jersey-barrier range on its ground with the lip before the barrier, its art (the lip's too) and studio showing, and no minigame card", () => {
      attractGround = activeGround();
      expect(engine["minigameMode"], "no minigame in play").toBe(null);
      expect(engine["barrierUp"], "the jersey barrier stands").toBeTruthy();
      expect(engine["rangeArt"]?.visible && engine["rangeArt"].getObjectByName(RANGE_LIP_ART)!.visible && activeGround().heightAt(-1, 0) > 0, "the sand, signs and lip show, and the lip is ground").toBeTruthy();
      expect(engine["studio"].length > 0 && engine["studio"].every((object) => object.visible), "the studio's disc, grid and rings show").toBeTruthy();
      expect(engine["looping"], "it loops").toBeTruthy();
      expect(hud.get().minigame, "no minigame card").toBe(null);
      expect(hud.get().range, "the range readout shows").not.toBe(null);
    });

    it("when the car meets the barrier, then its driver is thrown once with no release boost", () => {
      launches.length = 0;
      for (let frame = 0; frame < 10 * FRAME_HZ && launches.length === 0; frame++) engine.advance(FRAME, { frameDt: FRAME });
      expect(launches.length, "one driver thrown").toBe(1);
      expect(launches[0]!.releaseScale, "the sandbox's throw is unscaled").toBe(undefined);
    });
  });

  for (const mode of MINIGAME_MODES) {
    describe(`given the ${mode} station`, () => {
      let samples: TorsoSample[] = [];
      let scoredHud: MinigameHudState;
      const car = () => engine["carA"];

      it("when it starts, then the car stands parked at the station's start, the seat only follows, and the card shows a ready attempt", () => {
        engine.startMinigame(mode);
        const start = engine["minigames"].stationStart();
        const position = car().group.position;
        expect(engine["minigameMode"], "the mode is on").toBe(mode);
        expect(Math.abs(position.x - start.x) < START_TOLERANCE && Math.abs(position.z - start.z) < START_TOLERANCE, `at the start (${position.x}, ${position.z})`).toBeTruthy();
        expect(car().parked, "parked").toBeTruthy();
        expect(engine["seat"].mode, "follow, not drive").toBe("follow");
        expect(hud.get().minigame?.mode, "the card is the mode's").toBe(mode);
        expect(hud.get().minigame?.phase, "ready").toBe("ready");
        expect(hud.get().range, "the attract readout is gone").toBe(null);
      });

      it("when three seconds pass with no input, then the car has not moved and the attempt is still ready", () => {
        const before = car().group.position.clone();
        runSeconds(engine, IDLE_WAIT_S);
        expect(car().group.position.distanceTo(before), `moved ${car().group.position.distanceTo(before)} m`).toBeLessThan(START_TOLERANCE);
        expect(minigameHud().phase, "ready").toBe("ready");
      });

      it("when the camera has settled on the parked car, then the car is in frame, near the middle, within 30 m of the eye", (t) => {
        const camera = engine["camera"];
        camera.clearViewOffset();
        camera.aspect = 4 / 3;
        camera.updateProjectionMatrix();
        camera.updateMatrixWorld(true);
        const inFrame = car().group.position.clone().project(camera);
        const distance = camera.position.distanceTo(car().group.position);
        t.annotate(`${mode}: car at (${inFrame.x.toFixed(2)}, ${inFrame.y.toFixed(2)}) of the frame, ${distance.toFixed(1)} m from the eye`);
        expect(inFrame.z <= 1 && Math.abs(inFrame.x) < PARKED_CAR_FRAME_LIMIT && Math.abs(inFrame.y) < PARKED_CAR_FRAME_LIMIT, `car at (${inFrame.x}, ${inFrame.y})`).toBeTruthy();
        expect(distance, `${distance} m from the eye`).toBeLessThan(PARKED_CAR_EYE_DISTANCE_LIMIT);
      });

      it("when the camera has settled on the parked car, then the eye stands behind it on its line and looks down its heading", (t) => {
        const camera = engine["camera"];
        const forward = car().forward;
        const behind = camera.position.clone().sub(car().group.position);
        const metresBehind = -behind.dot(forward);
        const metresAside = Math.abs(behind.x * forward.z - behind.z * forward.x);
        const looking = camera.getWorldDirection(new THREE.Vector3()).dot(forward);
        t.annotate(`${mode}: eye ${metresBehind.toFixed(1)} m behind, ${metresAside.toFixed(1)} m aside, looking ${looking.toFixed(2)} along the heading`);
        expect(metresBehind >= PARKED_EYE_BEHIND_MIN && metresAside <= PARKED_EYE_ASIDE_MAX, `${metresBehind} m behind, ${metresAside} m aside`).toBeTruthy();
        expect(looking, `looking ${looking} along the heading`).toBeGreaterThanOrEqual(PARKED_EYE_LOOKING_MIN);
      });

      it("when the throttle is pressed, then the seat takes the wheel, the car drives off and the attempt is running", () => {
        const before = car().group.position.clone();
        engine["keys"].add(THROTTLE_KEY);
        runSeconds(engine, 2);
        expect(engine["seat"].mode, "driving").toBe("drive");
        expect(car().group.position.distanceTo(before), `moved ${car().group.position.distanceTo(before)} m`).toBeGreaterThan(5);
        expect(minigameHud().phase, "running").toBe("running");
        releaseThrottle();
      });

      it("when Reset run is pressed before the throw, then the car is back at the start, parked, and the attempt is ready and not used", () => {
        const attemptBefore = minigameHud().attempt;
        engine.resetMinigameRun();
        const start = engine["minigames"].stationStart();
        expect(Math.abs(car().group.position.x - start.x), "back at the start").toBeLessThan(START_TOLERANCE);
        expect(car().parked, "parked").toBeTruthy();
        expect(minigameHud().phase, "ready").toBe("ready");
        expect(minigameHud().attempt, "no attempt used").toBe(attemptBefore);
      });

      it("when the player drives to the lip, then one driver is thrown with this mode's boost and the throw scores what the model reads from the dummy's torso", () => {
        launches.length = 0;
        samples = throwAndRead(mode);
        expect(launches.length, "exactly one throw").toBe(1);
        const boost = launches[0]!.releaseScale!;
        const expectedBoost = mode === "longJump" ? bailRelease(THROW_BOOST.longJump, 0) : THROW_BOOST[mode];
        expect(boost.forward, "the mode's forward").toBe(expectedBoost.forward);
        expect(boost.upward, "the mode's upward").toBe(expectedBoost.upward);
        expect(boost.elevation, "the mode's elevation").toBe(expectedBoost.elevation);
        scoredHud = minigameHud();
        expect(scoredHud.phase, "scored").toBe("scored");
        expect(scoredHud.lastScore, "the score").toBe(expectedScore(mode, samples));
      });

      it("when the best was stored, then a new session on the same storage reads it as this car's and the overall best", () => {
        const fresh = new MinigameSession(minigameStore());
        fresh.begin(mode, { carType: "sedan", throwsPerSet: scoredHud.throwsPerSet ?? undefined, highJump: { postsX: engine["minigames"]["highJump"].postsX, lipY: lipHeight("highJump") } });
        // A Ring Fling set keeps its total only once the set is complete; the other modes keep each throw.
        const recorded = scoredHud.throwsPerSet === null ? scoredHud.lastScore! : scoredHud.setComplete ? scoredHud.setTotal : 0;
        const score = recorded;
        if (score > 0) {
          expect(fresh.hud().best.thisCar, "this car's best").toBe(score);
          expect(fresh.hud().best.overall, "the overall best").toBe(score);
        } else {
          expect(fresh.hud().best.thisCar, "a score of 0 is no best").toBe(null);
        }
        expect(scoredHud.best.thisCar, "the engine's card shows this car's best").toBe(fresh.hud().best.thisCar);
        expect(scoredHud.best.overall, "the engine's card shows the overall best").toBe(fresh.hud().best.overall);
      });

      it(`when ${HOLD_CHECK_S} s pass after the throw, then the dummy is alive, the camera still rides him, and nothing reset: no timer, no loop`, () => {
        const generation = engine["clearGen"]();
        const before = JSON.stringify(minigameHud());
        runSeconds(engine, HOLD_CHECK_S);
        const torso = new THREE.Vector3();
        expect(engine["ragdolls"].latest(torso), "the dummy is still out").toBeGreaterThanOrEqual(0);
        expect(engine["ragdolls"].rideAlong, "the ride camera still follows him").toBeTruthy();
        expect(engine["clearGen"](), "the scene was not cleared").toBe(generation);
        expect(JSON.stringify(minigameHud()), "the session is unchanged").toBe(before);
        expect(engine["camera"].position.distanceTo(torso), `the camera is ${engine["camera"].position.distanceTo(torso)} m from him`).toBeLessThan(60);
      });

      it("when Retry is pressed, then the dummy is released, the car is back at the start parked, and the next attempt is ready", () => {
        const attemptBefore = minigameHud().attempt;
        engine.retryMinigame();
        const start = engine["minigames"].stationStart();
        expect(engine["ragdolls"].latest(new THREE.Vector3()), "no dummy out").toBeLessThan(0);
        expect(Math.abs(car().group.position.x - start.x), "at the start").toBeLessThan(START_TOLERANCE);
        expect(car().parked, "parked").toBeTruthy();
        expect(minigameHud().phase, "ready").toBe("ready");
        expect(minigameHud().attempt, "the next attempt").toBe(attemptBefore + 1);
      });

      if (mode === "highJump") {
        it("when Retry restacks the boxes, then every box stands at its placement", () => {
          const poses = new Float32Array(BOX_COUNT * BOX_POSE_FLOATS);
          const count = engine["ragdolls"].copyBoxPoses(poses);
          const placements = engine["minigames"]["boxPlacements"].highJump!;
          expect(count, "box count").toBe(placements.length);
          for (let box = 0; box < count; box++) {
            const placement = placements[box]!;
            const at = box * BOX_POSE_FLOATS;
            expect(Math.hypot(poses[at]! - placement.x, poses[at + 1]! - placement.y, poses[at + 2]! - placement.z), `box ${box} at its place`).toBeLessThan(0.01);
          }
        });
      }
    });
  }

  describe("given a minigame is on and the player picks the modes in turn", () => {
    const picks = [
      { it: "when Long jump is picked, then the jersey barrier stands, the range's sand shows without its lip and only the long jump's station art shows", mode: "longJump", barrier: true, rangeArt: true },
      { it: "when High jump is picked, then the barrier is down, the range's sand is hidden and only the high jump's station art shows", mode: "highJump", barrier: false, rangeArt: false },
      { it: "when Ring Fling is picked, then the barrier is down, the range's sand is hidden and only Ring Fling's station art shows", mode: "ringFling", barrier: false, rangeArt: false },
    ] as const;
    for (const testCase of picks) {
      it(testCase.it, () => {
        engine.startMinigame(testCase.mode);
        const art = engine["minigames"]["art"]!;
        expect(activeGround(), "the minigame ground is the world's ground").toBe(engine["minigames"].groundInPlay);
        expect(activeGround(), "not the flat attract ground").not.toBe(attractGround);
        expect(engine["barrierUp"], "barrier up").toBe(testCase.barrier);
        expect(engine["barrier"].group.visible, "barrier drawn").toBe(testCase.barrier);
        expect(engine["rangeArt"]!.visible === testCase.rangeArt && !engine["rangeArt"]!.getObjectByName(RANGE_LIP_ART)!.visible, "range art, never the lip").toBeTruthy();
        expect(engine["studio"].every((object) => !object.visible), "the studio is hidden").toBeTruthy();
        expect(art.group.visible, "the minigame art shows").toBeTruthy();
        for (const mode of MINIGAME_MODES) expect(art["stations"][mode].visible, `${mode}'s station art`).toBe(mode === testCase.mode);
      });
    }

    it("when another mode is picked after a throw, then the dummy is released and the car stands at the new station's start", () => {
      engine.startMinigame("ringFling");
      throwAndRead("ringFling");
      expect(engine["ragdolls"].latest(new THREE.Vector3()), "the dummy lies out").toBeGreaterThanOrEqual(0);
      engine.startMinigame("longJump");
      const start = engine["minigames"].stationStart();
      expect(engine["ragdolls"].latest(new THREE.Vector3()), "the dummy is released").toBeLessThan(0);
      expect(Math.abs(engine["carA"].group.position.x - start.x), "at the long jump's start").toBeLessThan(START_TOLERANCE);
      expect(minigameHud().mode, "the card follows").toBe("longJump");
      expect(minigameHud().attempt, "a fresh first attempt").toBe(1);
    });

    it("when the Ring Fling set length is changed, then the card shows it, the set starts again at the start, and a later pick keeps it", () => {
      engine.startMinigame("ringFling");
      engine.setMinigameThrowsPerSet(3);
      expect(minigameHud().throwsPerSet, "three throws").toBe(3);
      expect(minigameHud().attempt, "the set restarted").toBe(1);
      expect(minigameHud().phase, "ready").toBe("ready");
      engine.startMinigame("longJump");
      engine.startMinigame("ringFling");
      expect(minigameHud().throwsPerSet, "kept").toBe(3);
    });

    it("when the free camera flies in a minigame, then its reach is the stations' footprint, not the fleet disc", () => {
      const bounds = engine["minigames"].bounds()!;
      engine["flyFree"](FRAME);
      const extent = engine["view"].free.extent;
      expect(extent.radius, "half the footprint's diagonal").toBe(Math.hypot(bounds.maxX - bounds.minX, bounds.maxZ - bounds.minZ) / 2);
      expect(extent.radius, "wider than the disc").toBeGreaterThan(DISC_RADIUS);
      expect(extent.x, "centre x").toBe((bounds.minX + bounds.maxX) / 2);
      expect(extent.z, "centre z").toBe((bounds.minZ + bounds.maxZ) / 2);
    });
  });

  describe("given a minigame with a dummy out, when Exit is pressed", () => {
    let seatModeBefore: string;
    it("then the attract Range is back exactly: flat ground, the barrier up, the studio and the range's art showing, no minigame card, no dummy", () => {
      engine.startMinigame("highJump");
      seatModeBefore = engine["seat"].mode;
      throwAndRead("highJump");
      engine.exitMinigame();
      expect(engine["minigameMode"], "no minigame").toBe(null);
      expect(activeGround(), "the flat attract ground").toBe(attractGround);
      expect(engine["barrierUp"] && engine["barrier"].group.visible, "the barrier stands").toBeTruthy();
      expect(engine["rangeArt"]!.visible, "the range's art shows").toBeTruthy();
      expect(engine["studio"].every((object) => object.visible), "the studio shows").toBeTruthy();
      expect(!engine["minigames"]["art"]!.group.visible, "the minigame art is hidden").toBe(true);
      expect(hud.get().minigame, "no minigame card").toBe(null);
      expect(hud.get().range, "the attract readout is back").not.toBe(null);
      expect(engine["ragdolls"].latest(new THREE.Vector3()), "the dummy is gone").toBeLessThan(0);
      expect(seatModeBefore, "the minigame had the seat following").not.toBe("global");
      expect(engine["seat"].mode, "the seat is let go").toBe("global");
    });

    it("then the attract loop runs again: its car is thrown with no boost and the scene loops", () => {
      launches.length = 0;
      const generation = engine["clearGen"]();
      runSeconds(engine, 30);
      expect(launches.length, "a driver was thrown").toBeGreaterThanOrEqual(1);
      for (const launch of launches) expect(launch.releaseScale, "no boost").toBe(undefined);
      expect(engine["clearGen"](), "the loop reset the scene").not.toBe(generation);
    });

    it("then the free camera's reach is the fleet disc again", () => {
      engine["flyFree"](FRAME);
      expect(engine["view"].free.extent.radius, "the disc").toBe(DISC_RADIUS);
    });
  });

  describe("given a minigame is on, when the player picks another scene", () => {
    it("then the minigame is over: its art is hidden, the ground and studio are the new scene's and the dummy is released", () => {
      engine["setScene"]("range");
      engine.startMinigame("highJump");
      throwAndRead("highJump");
      engine["setScene"]("fleet");
      expect(engine["minigames"].mode, "the minigame ended").toBe(null);
      expect(!engine["minigames"]["art"]!.group.visible, "the art is hidden").toBe(true);
      expect(activeGround(), "not the minigame ground").not.toBe(engine["minigames"]["ground"]);
      expect(engine["studio"].every((object) => object.visible), "the studio shows").toBeTruthy();
      expect(engine["ragdolls"].latest(new THREE.Vector3()), "the dummy is released").toBeLessThan(0);
      expect(hud.get().minigame, "no minigame card").toBe(null);
    });

    it("then returning to the Range is the attract range, not the minigame", () => {
      engine["setScene"]("range");
      expect(engine["minigameMode"], "no minigame").toBe(null);
      expect(activeGround(), "the flat ground").toBe(attractGround);
      expect(engine["barrierUp"], "the barrier stands").toBeTruthy();
    });
  });

  describe("given a minigame with a scored sedan best, when the player picks another car", () => {
    it("then the card shows the new car's own best (none yet) next to the overall best, and the attempt starts again", () => {
      engine.startMinigame("longJump");
      expect(minigameHud().best.overall, "a long jump best exists from the sedan's throw").not.toBe(null);
      engine.setPlayerCar("monster");
      expect(minigameHud().best.thisCar, "the monster has no best").toBe(null);
      expect(minigameHud().best.overall, "the overall best is kept").not.toBe(null);
      expect(minigameHud().phase, "ready").toBe("ready");
      expect(engine["minigameMode"], "still in the minigame").toBe("longJump");
    });
  });

  describe("given the long jump driven from the parked start at full throttle by each driver car, with no bail", () => {
    for (const driverCar of DRIVER_CARS) {
      if (driverCar.id === "monster") {
        it("when a monster holds the throttle to the barrier and presses no bail, then it flies the barrier and lands past it with its driver in: nobody is thrown, the bail meets no hit, and the attempt ends as a no throw within the rest hold of its settling", () => {
          engine.setPlayerCar("monster");
          engine.startMinigame("longJump");
          expect(minigameHud().phase, "ready").toBe("ready");
          launches.length = 0;
          engine["keys"].add(THROTTLE_KEY);
          runSeconds(engine, LONG_JUMP_PAST_S);
          const x = engine["cars"][0]!.group.position.x - STATION_ANCHORS.longJump.x;
          engine["keys"].delete(THROTTLE_KEY);
          let restS = 0;
          for (let frame = 0; frame < THROW_TIMEOUT_S * FRAME_HZ && minigameHud().phase !== "scored"; frame++) {
            engine.advance(FRAME, { frameDt: FRAME });
            restS = engine["carA"].moving ? 0 : restS + FRAME;
          }
          const card = minigameHud();
          expect(launches.length, "nobody thrown").toBe(0);
          expect(engine["minigames"]["bail"]["hitAt"], "the bail met no hit").toBe(null);
          expect(x, `the monster stands at local x ${x.toFixed(1)} m, not past the barrier`).toBeGreaterThan(BARRIER_HALF.x);
          expect(card.phase, "the attempt ended").toBe("scored");
          expect(card.noThrow, "as a no throw").toBe(true);
          expect(restS, `it scored ${restS.toFixed(2)} s after the monster settled, not within the rest hold`).toBeLessThanOrEqual(REST_HOLD + 2 * FRAME);
        });
        continue;
      }
      it(`when a ${driverCar.id} holds the throttle to the barrier and presses no bail, then its driver is thrown exactly once and the throw scores the dummy's rest distance, mid-field`, (t) => {
        engine.setPlayerCar(driverCar.id);
        engine.startMinigame("longJump");
        expect(minigameHud().phase, "ready").toBe("ready");
        launches.length = 0;
        const samples = throwAndRead("longJump");
        expect(launches.length, "exactly one throw").toBe(1);
        expect(minigameHud().phase, "scored").toBe("scored");
        t.annotate(`${driverCar.id}: scored ${minigameHud().lastScore!.toFixed(1)} m`);
        expect(minigameHud().lastScore, "the score is the torso's x at rest").toBe(expectedScore("longJump", samples));
        expect(minigameHud().lastScore!, `he rested at ${minigameHud().lastScore} m, not past ${LONG_JUMP_NO_BAIL_MINIMUM} m`).toBeGreaterThan(LONG_JUMP_NO_BAIL_MINIMUM);
        expect(minigameHud().lastScore!, `he rested at ${minigameHud().lastScore} m, past ${LONG_JUMP_NO_BAIL_MAXIMUM} m`).toBeLessThan(LONG_JUMP_NO_BAIL_MAXIMUM);
      });
    }
  });

  describe("given the High jump's dummy climbing to a great height", () => {
    const FRAME_EDGE = 0.95;
    const cases = [
      { it: "when he is thrown as the sim throws him, then he is inside the central frame in every frame of his flight to rest", upward: 1 },
      { it: "when he is thrown with a 1.2 times faster climb (about 58 m/s up), then he is still inside the central frame in every frame", upward: 1.2 },
    ] as const;
    for (const testCase of cases) {
      it(testCase.it, () => {
        const ragdolls = engine["ragdolls"];
        const spy = ragdolls.launch;
        ragdolls.launch = (e, cars, rides) => spy(e, cars, rides, { forward: 1, upward: testCase.upward, elevation: null });
        const camera = engine["camera"];
        camera.clearViewOffset();
        camera.aspect = 4 / 3;
        engine.startMinigame("highJump");
        const torso = new THREE.Vector3();
        let worstOffCentre = 0;
        let framesOut = 0;
        let framesSeen = 0;
        let firstOut: string | undefined;
        engine["keys"].add(THROTTLE_KEY);
        for (let frame = 0; frame < THROW_TIMEOUT_S * FRAME_HZ; frame++) {
          engine.advance(FRAME, { frameDt: FRAME });
          const still = ragdolls.latest(torso);
          if (still >= REST_HOLD) break;
          if (still < 0) continue;
          camera.updateProjectionMatrix();
          camera.updateMatrixWorld(true);
          const inFrame = torso.clone().project(camera);
          worstOffCentre = Math.max(worstOffCentre, Math.abs(inFrame.x), Math.abs(inFrame.y));
          framesSeen++;
          if (inFrame.z > 1 || Math.abs(inFrame.x) > FRAME_EDGE || Math.abs(inFrame.y) > FRAME_EDGE) {
            framesOut++;
            firstOut ??= `frame ${framesSeen} torso y ${torso.y.toFixed(1)} x ${torso.x.toFixed(1)} ndc (${inFrame.x.toFixed(2)}, ${inFrame.y.toFixed(2)}) z ${inFrame.z.toFixed(2)}`;
          }
        }
        releaseThrottle();
        ragdolls.launch = spy;
        expect(framesSeen, `${framesSeen} frames of flight`).toBeGreaterThan(100);
        expect(framesOut, `${framesOut} frames out of ${framesSeen}, worst ${worstOffCentre} half-heights off centre; first: ${firstOut}`).toBe(0);
      });
    }
  });

  describe("given the player framed the view by hand (the wheel) before the throw", () => {
    const cases = [
      { it: "when a sedan is driven to the long jump's barrier, then the ride camera takes the dummy and the eye is within 60 m of him", mode: "longJump", carId: "sedan" },
      { it: "when a sedan is driven to the high jump's lip, then the ride camera takes the dummy and the eye is within 60 m of him", mode: "highJump", carId: "sedan" },
      { it: "when a monster is driven to the high jump's lip, then the ride camera takes the dummy and the eye is within 60 m of him", mode: "highJump", carId: "monster" },
      { it: "when a sedan is driven to Ring Fling's lip, then the ride camera takes the dummy and the eye is within 60 m of him", mode: "ringFling", carId: "sedan" },
      { it: "when a monster is driven to Ring Fling's lip, then the ride camera takes the dummy and the eye is within 60 m of him", mode: "ringFling", carId: "monster" },
    ] as const;
    for (const testCase of cases) {
      it(testCase.it, () => {
        engine.setPlayerCar(testCase.carId);
        engine.startMinigame(testCase.mode);
        engine["view"]["onWheel"](Object.assign(new Event("wheel"), { deltaY: WHEEL_STEP, preventDefault() {} }) as WheelEvent);
        expect(engine["view"].userFramed, "the wheel framed the view").toBeTruthy();
        const torso = new THREE.Vector3();
        engine["keys"].add(THROTTLE_KEY);
        for (let frame = 0; frame < THROW_TIMEOUT_S * FRAME_HZ && engine["ragdolls"].latest(torso) < 0; frame++) engine.advance(FRAME, { frameDt: FRAME });
        runSeconds(engine, RIDE_SETTLE_S);
        engine["ragdolls"].latest(torso);
        releaseThrottle();
        expect(engine["ragdolls"].rideAlong, "the ride camera follows him").toBeTruthy();
        expect(engine["camera"].position.distanceTo(torso), `the eye is ${engine["camera"].position.distanceTo(torso)} m from him`).toBeLessThan(60);
      });
    }
  });

  describe("given every driver car driven from the parked start to the lip of the high jump and of Ring Fling", () => {
    const cases = DRIVER_CARS.flatMap((driverCar) => (["highJump", "ringFling"] as const).map((mode) => ({ it: `when a ${driverCar.id} holds the throttle on the ${mode} station, then its driver is thrown exactly once, at the lip, with the mode's boost`, carId: driverCar.id, mode })));
    for (const testCase of cases) {
      it(testCase.it, () => {
        engine.setPlayerCar(testCase.carId);
        engine.startMinigame(testCase.mode);
        launches.length = 0;
        const samples = throwAndRead(testCase.mode);
        expect(launches.length, "exactly one throw").toBe(1);
        expect(launches[0]!.releaseScale, "the mode's boost").toBe(THROW_BOOST[testCase.mode]);
        expect(samples.length, "he flew").toBeGreaterThan(0);
        expect(minigameHud().phase, "scored").toBe("scored");
      });
    }
  });

  describe("given the ride camera framing a dummy", () => {
    const leads: { it: string; mode: MinigameMode | null; expectedLead: number }[] = [
      { it: "when a High jump dummy is framed, then the aim lead is MINIGAME_AIM_LEAD", mode: "highJump", expectedLead: MINIGAME_AIM_LEAD },
      { it: "when a Long jump dummy is framed, then the aim lead is MINIGAME_AIM_LEAD", mode: "longJump", expectedLead: MINIGAME_AIM_LEAD },
      { it: "when the attract Range's dummy is framed, then there is no aim lead", mode: null, expectedLead: 0 },
    ];
    for (const testCase of leads) {
      it(testCase.it, () => {
        const ragdolls = engine["ragdolls"];
        const original = ragdolls.frameCamera;
        const seen: number[] = [];
        ragdolls.frameCamera = (camera, wallDt, hold, watched, held, lens, sight, lead) => {
          seen.push(lead ?? 0);
          return original.call(ragdolls, camera, wallDt, hold, watched, held, lens, sight, lead);
        };
        if (testCase.mode === null) engine.exitMinigame();
        else engine.startMinigame(testCase.mode);
        engine["looping"] = false;
        engine["keys"].add(THROTTLE_KEY);
        for (let frame = 0; frame < 20 * FRAME_HZ && ragdolls.latest(new THREE.Vector3()) < 0; frame++) engine.advance(FRAME, { frameDt: FRAME });
        runSeconds(engine, 1);
        releaseThrottle();
        ragdolls.frameCamera = original;
        engine["looping"] = true;
        expect(ragdolls.latest(new THREE.Vector3()), "a dummy is out").toBeGreaterThanOrEqual(0);
        expect(seen.length, "the camera framed him").toBeGreaterThan(0);
        for (const lead of seen) expect(lead, "the lead passed").toBe(testCase.expectedLead);
      });
    }
  });

  describe("given the long jump's bail pressed through the real boost key", () => {
    const BOOST_KEY = "ShiftLeft";
    /** How far (s) the stamped press may be from the asked offset: a frame of presented time (the press is stamped at the end of the frame that polled it). */
    const PRESS_TOLERANCE_S = 0.04;
    /** A perfect bail rests at least this much (m) past the same run with no press. */
    const PERFECT_OVER_NONE_M = 30;
    /** An early or late 0.1 s press rests this much (m) short of a perfect one and past a no-press one. */
    const FADE_MARGIN_M = 5;
    const WASTED_EARLY_S = -0.6;
    const AFTER_THE_THROW_S = 0.5;
    /** A wasted bail, whose throw goes at the hit with the no-press release, rests this near (m) a no-press run's (the car has moved on a quarter second by the no-press throw). */
    const WASTED_SCATTER_M = 6;
    const BOOST_HOLD_S = 1;
    /** The sedan and the farthest thrower, the muscle (the monster flies the barrier: no hit to bail on). */
    const FADE_CLASS_IDS = ["sedan", "muscle"] as const;
    type BailRun = { verdict: BailVerdict; score: number; hitRelative: number };

    /** A long jump at full throttle with the boost key tapped one frame when `pressRelative` s of presented time have run since the throttle went down (null: never). */
    const driveBail = (carId: string, pressRelative: number | null): BailRun => {
      engine.setPlayerCar(carId);
      engine.startMinigame("longJump");
      const origin = engine["elapsedWall"];
      engine["keys"].add(THROTTLE_KEY);
      let pressed = false;
      for (let frame = 0; frame < THROW_TIMEOUT_S * FRAME_HZ && minigameHud().phase !== "scored"; frame++) {
        if (pressRelative !== null && !pressed && engine["elapsedWall"] - origin >= pressRelative) {
          engine["keys"].add(BOOST_KEY);
          pressed = true;
        }
        engine.advance(FRAME, { frameDt: FRAME });
        engine["keys"].delete(BOOST_KEY);
      }
      releaseThrottle();
      return { verdict: minigameHud().bail!.verdict!, score: minigameHud().lastScore!, hitRelative: engine["minigames"]["bail"]["hitAt"]! - origin };
    };

    /** A car's first run after the engine seats it is thrown 0.06 s sooner than its later ones, so a newly seated car drives one run that is not read. */
    const bailRun = (carId: string, pressRelative: number | null): BailRun => {
      if (engine["playerCar"].id !== carId) driveBail(carId, null);
      return driveBail(carId, pressRelative);
    };

    const noPressRuns = new Map<string, BailRun>();
    const perfectRuns = new Map<string, BailRun>();

    /** The no-press run every other run of `carId` is read against: made once. */
    const baseline = (carId: string): BailRun => {
      if (!noPressRuns.has(carId)) noPressRuns.set(carId, bailRun(carId, null));
      return noPressRuns.get(carId)!;
    };

    /** The run of `carId` with the press on the hit, which the perfect row and the fade rows read against: made once. */
    const perfectRun = (carId: string): BailRun => {
      if (!perfectRuns.has(carId)) perfectRuns.set(carId, bailRun(carId, baseline(carId).hitRelative));
      return perfectRuns.get(carId)!;
    };

    for (const driverCar of LONG_JUMP_CARS) {
      it(`when a ${driverCar.id} taps the boost key on the hit, then the bail is perfect and he rests at least ${PERFECT_OVER_NONE_M} m past the same run with no press`, () => {
        const none = baseline(driverCar.id);
        const perfect = perfectRun(driverCar.id);
        expect(none.verdict.kind, "no press is no bail").toBe("none");
        expect(perfect.verdict.kind, `${driverCar.id}'s press at ${perfect.verdict.offsetSeconds} s from the hit`).toBe("perfect");
        expect(Math.abs(perfect.hitRelative - none.hitRelative), `the barrier was reached ${perfect.hitRelative - none.hitRelative} s apart`).toBeLessThan(PRESS_TOLERANCE_S);
        expect(perfect.score - none.score, `${driverCar.id}: perfect ${perfect.score.toFixed(1)} m against none ${none.score.toFixed(1)} m`).toBeGreaterThanOrEqual(PERFECT_OVER_NONE_M);
      });
    }

    for (const carId of FADE_CLASS_IDS) {
      const offsets = [
        { it: "an early", offset: -0.1, expectedKind: "early" },
        { it: "a late", offset: 0.1, expectedKind: "late" },
      ] as const;
      for (const testCase of offsets) {
        it(`when a ${carId} taps the boost key ${Math.abs(testCase.offset)} s from the hit (${testCase.it} press), then the bail is ${testCase.expectedKind} by that much and he rests between the no-press and the perfect run`, () => {
          const none = baseline(carId);
          const perfect = perfectRun(carId);
          const run = bailRun(carId, none.hitRelative + testCase.offset);
          expect(run.verdict.kind, `kind at ${run.verdict.offsetSeconds} s`).toBe(testCase.expectedKind);
          expect(Math.abs(run.verdict.offsetSeconds! - testCase.offset), `offset ${run.verdict.offsetSeconds} against ${testCase.offset}`).toBeLessThan(PRESS_TOLERANCE_S);
          expect(run.score, `${run.score.toFixed(1)} m is not past no press ${none.score.toFixed(1)} m`).toBeGreaterThan(none.score + FADE_MARGIN_M);
          expect(run.score, `${run.score.toFixed(1)} m is not short of perfect ${perfect.score.toFixed(1)} m`).toBeLessThan(perfect.score - FADE_MARGIN_M);
        });
      }
    }

    it("when a sedan taps the boost key far too early, then the bail is wasted: too early, and he rests where a no-press run does", () => {
      const none = baseline("sedan");
      const wasted = bailRun("sedan", none.hitRelative + WASTED_EARLY_S);
      expect(wasted.verdict.kind, "kind").toBe("tooEarly");
      expect(Math.abs(wasted.score - none.score), `wasted ${wasted.score.toFixed(1)} m against none ${none.score.toFixed(1)} m`).toBeLessThan(WASTED_SCATTER_M);
    });

    it("when a sedan taps the boost key after the throw has gone, then the bail is too late and the throw was the no-press one", () => {
      const none = baseline("sedan");
      const late = bailRun("sedan", none.hitRelative + AFTER_THE_THROW_S);
      expect(late.verdict.kind, "kind").toBe("tooLate");
      expect(Math.abs(late.score - none.score), `late ${late.score.toFixed(1)} m against none ${none.score.toFixed(1)} m`).toBeLessThan(1);
    });

    it("when the boost key is held on the parked car before the throttle, then it is no press and the bail is still open", () => {
      engine.setPlayerCar("sedan");
      engine.startMinigame("longJump");
      engine["keys"].add(BOOST_KEY);
      runSeconds(engine, 0.5);
      engine["keys"].delete(BOOST_KEY);
      expect(minigameHud().phase, "still ready").toBe("ready");
      expect(minigameHud().bail!.pressed, "not pressed").toBe(false);
    });

    it(`when the boost key and the throttle are held for ${BOOST_HOLD_S} s, then the long jump's car never boosts and the meter is not drained, and the high jump's car does`, () => {
      const holdBoost = (mode: MinigameMode) => {
        engine.setPlayerCar("sedan");
        engine.startMinigame(mode);
        engine["keys"].add(THROTTLE_KEY);
        engine["keys"].add(BOOST_KEY);
        runSeconds(engine, BOOST_HOLD_S);
        const boosting = engine["carA"].drive.boostK;
        const meter = engine["seat"].boost;
        engine["keys"].delete(BOOST_KEY);
        releaseThrottle();
        return { boosting, meter };
      };
      const longJump = holdBoost("longJump");
      const highJump = holdBoost("highJump");
      expect(longJump.boosting, "the long jump car's boost thrust").toBe(0);
      expect(longJump.meter, "the long jump's meter is full").toBe(1);
      expect(highJump.boosting, "the high jump car's boost thrust").toBe(1);
      expect(highJump.meter, `the high jump's meter drained to ${highJump.meter}`).toBeLessThan(1);
    });

    /** What one long jump did to the crash clock: every frame's time scale from the hit to the throw's release, the frames that took, the lowest scale before the hit and after the release, and the bail's verdict. */
    type ClockRun = { scalesHitToRelease: number[]; framesHitToRelease: number; lowestScaleBeforeHit: number; lowestScaleAfterRelease: number; verdict: BailVerdict };

    /** A long jump at full throttle, the throttle let go at x `liftAtX` (null: held to the barrier), the boost key tapped `tapFramesAfterHit` presented frames after the hit (null: never). */
    const clockRun = (liftAtX: number | null, tapFramesAfterHit: number | null): ClockRun => {
      engine.setPlayerCar("sedan");
      engine.startMinigame("longJump");
      engine["keys"].add(THROTTLE_KEY);
      const run: ClockRun = { scalesHitToRelease: [], framesHitToRelease: 0, lowestScaleBeforeHit: 1, lowestScaleAfterRelease: 1, verdict: { kind: "none", offsetSeconds: null, quality: 0 } };
      let hitFrame = -1;
      let released = false;
      for (let frame = 0; frame < THROW_TIMEOUT_S * FRAME_HZ && minigameHud().phase !== "scored"; frame++) {
        if (liftAtX !== null && engine["carA"].group.position.x >= liftAtX) engine["keys"].delete(THROTTLE_KEY);
        if (tapFramesAfterHit !== null && hitFrame >= 0 && frame - hitFrame === tapFramesAfterHit) engine["keys"].add(BOOST_KEY);
        engine.advance(FRAME, { frameDt: FRAME });
        engine["keys"].delete(BOOST_KEY);
        const scale = engine["clock"].timeScale;
        if (engine["minigames"]["bail"]["hitAt"] === null) run.lowestScaleBeforeHit = Math.min(run.lowestScaleBeforeHit, scale);
        else if (!released) {
          if (hitFrame < 0) hitFrame = frame;
          run.scalesHitToRelease.push(scale);
          if (engine["minigames"]["heldThrow"] === null) {
            released = true;
            run.framesHitToRelease = frame - hitFrame;
          }
        } else run.lowestScaleAfterRelease = Math.min(run.lowestScaleAfterRelease, scale);
      }
      releaseThrottle();
      run.verdict = minigameHud().bail!.verdict!;
      return run;
    };

    /** A lifted throttle at this x (m): the car coasts into the barrier slower, which the slow-mo's own prediction (`throwComing`) does not expect to throw him. */
    const COASTING_LIFT_X = -10;
    /** The clock's slow scale (`IMPACT_SCALE`): the throw's slow-mo must come, and only after the release. */
    const SLOW_ENOUGH = 0.5;
    /** The press and the throw's hold are in real time: presented frames from the hit, at 60 Hz. */
    const WINDOW_FRAMES = Math.round(BAIL_WINDOW_SECONDS * FRAME_HZ);
    const FRAME_SLACK = 2;
    const cases = [
      { it: "held to the barrier", liftAtX: null },
      { it: "let go at x -10 so the car coasts into it", liftAtX: COASTING_LIFT_X },
    ] as const;
    for (const testCase of cases) {
      it(`when the throttle is ${testCase.it} and no bail is pressed, then the clock runs at 1x from the start to the release, the throw goes at the window's end in presented time, and the slow-mo comes after it`, () => {
        const run = clockRun(testCase.liftAtX, null);
        expect(run.lowestScaleBeforeHit, "the approach is at 1x").toBe(1);
        expect(run.scalesHitToRelease.length, "the barrier was hit").toBeGreaterThan(0);
        expect(Math.min(...run.scalesHitToRelease), `the lowest scale between the hit and the release, over ${run.scalesHitToRelease.length} frames`).toBe(1);
        expect(Math.abs(run.framesHitToRelease - WINDOW_FRAMES), `${run.framesHitToRelease} presented frames from the hit to the release, not ${WINDOW_FRAMES}`).toBeLessThanOrEqual(FRAME_SLACK);
        expect(run.lowestScaleAfterRelease, `the slow-mo after the release reached only ${run.lowestScaleAfterRelease}`).toBeLessThan(SLOW_ENOUGH);
      });
    }

    /** Frames of an attempt's start compared: a second of full throttle off the hilltop. */
    const START_FRAMES = FRAME_HZ;
    /** The car's x (m) over each of an attempt's first `START_FRAMES` frames at full throttle from the long jump's start. */
    const startOf = (): number[] => {
      engine.setPlayerCar("sedan");
      engine.startMinigame("longJump");
      engine["keys"].add(THROTTLE_KEY);
      const xs: number[] = [];
      for (let frame = 0; frame < START_FRAMES; frame++) {
        engine.advance(FRAME, { frameDt: FRAME });
        xs.push(engine["carA"].group.position.x);
      }
      releaseThrottle();
      return xs;
    };

    // The coasting run above took 22 frames from the hit to the release after a held run and 15 on its own: the pacer's slice time owed and
    // floor learned in the held run's slow-mo carried into the next attempt, whose first frame stepped half as far (0.18 m/s against 0.37).
    it("when a long jump is attempted right after a thrown one and again after a short drive, then both attempts step alike from their first frame", () => {
      clockRun(null, null);
      const afterThrow = startOf();
      const afterDrive = startOf();
      const first = afterThrow.findIndex((x, frame) => x !== afterDrive[frame]);
      expect(first, `frame ${first}: x ${afterThrow[first]} after the throw against ${afterDrive[first]} after the drive`).toBe(-1);
    });

    const presses = [
      { it: "0.1 s", framesAfterHit: Math.round(0.1 * FRAME_HZ), expectedKind: "late", expectedOffsetS: 0.1 },
      { it: "0.5 s", framesAfterHit: Math.round(0.5 * FRAME_HZ), expectedKind: "tooLate", expectedOffsetS: 0.5 },
    ] as const;
    for (const press of presses) {
      it(`when the boost key is tapped ${press.it} of presented time after the hit on a coasting run, then the bail is ${press.expectedKind} by that much and not perfect`, () => {
        const run = clockRun(COASTING_LIFT_X, press.framesAfterHit);
        expect(run.verdict.kind, `verdict at ${run.verdict.offsetSeconds} s`).toBe(press.expectedKind);
        expect(Math.abs(run.verdict.offsetSeconds! - press.expectedOffsetS), `offset ${run.verdict.offsetSeconds} against ${press.expectedOffsetS}`).toBeLessThan(PRESS_TOLERANCE_S);
      });
    }
  });

  describe("given a long jump attempt in which the barrier throws nobody (the car is lifted off the throttle short of it)", () => {
    /** A run is read this long (s) after the car settles: the rest hold the dummy's own scoring waits, and a second to spare. */
    const RESOLVE_AFTER_REST_S = REST_HOLD + 1;
    const NO_THROW_TIMEOUT_S = 60;
    /** The car has left its hilltop spot when it is this far (m) from it. */
    const LEFT_START_M = 1;

    /** A long jump at full throttle until the car passes `liftAtX`, then coasting, until it has lain at rest `RESOLVE_AFTER_REST_S` (or the timeout): the seconds it rested. */
    const coastToRest = (liftAtX: number): number => {
      const startX = engine["carA"].group.position.x;
      engine["keys"].add(THROTTLE_KEY);
      let left = false;
      let restS = 0;
      for (let frame = 0; frame < NO_THROW_TIMEOUT_S * FRAME_HZ && restS < RESOLVE_AFTER_REST_S; frame++) {
        if (engine["carA"].group.position.x >= liftAtX) engine["keys"].delete(THROTTLE_KEY);
        engine.advance(FRAME, { frameDt: FRAME });
        left ||= Math.abs(engine["carA"].group.position.x - startX) > LEFT_START_M;
        restS = left && !engine["carA"].moving ? restS + FRAME : 0;
      }
      engine["keys"].delete(THROTTLE_KEY);
      return restS;
    };

    const cases = [
      { it: "rolls into the barrier too slowly to throw him", liftAtX: -16 },
      { it: "stops short of the barrier on the hill", liftAtX: -30 },
    ] as const;
    for (const testCase of cases) {
      it(`when the throttle is let go at x ${testCase.liftAtX} and the car ${testCase.it}, then the attempt ends as no throw within ${RESOLVE_AFTER_REST_S} s of the car settling, with no score and no dummy launched`, () => {
        engine.setPlayerCar("sedan");
        engine.startMinigame("longJump");
        const launched = launches.length;
        const bestBefore = minigameHud().best.thisCar;
        const restS = coastToRest(testCase.liftAtX);
        const card = minigameHud();
        expect(restS, `the car never settled (rested ${restS.toFixed(2)} s)`).toBeGreaterThanOrEqual(RESOLVE_AFTER_REST_S);
        expect(card.phase, `${restS.toFixed(2)} s after the car settled at x ${engine["carA"].group.position.x.toFixed(2)}, the attempt is still ${card.phase}`).toBe("scored");
        expect(card.noThrow, "the attempt is a no throw").toBe(true);
        expect(card.lastScore, "no score").toBe(null);
        expect(card.best.thisCar, "the best is untouched").toBe(bestBefore);
        expect(card.bail!.verdict, "no bail verdict: nobody was thrown").toBe(null);
        expect(launches.length, "no dummy was launched").toBe(launched);
      });
    }

    it("when a no throw is retried, then the same attempt is ready again on the hilltop with the card cleared, and it can be thrown", () => {
      engine.setPlayerCar("sedan");
      engine.startMinigame("longJump");
      coastToRest(-16);
      const ended = minigameHud();
      engine.retryMinigame();
      const again = minigameHud();
      expect(again.phase, "Retry readies the next run").toBe("ready");
      expect(again.noThrow, "the next run is not a no throw").toBe(false);
      expect(again.attempt, "a no throw uses no attempt").toBe(ended.attempt);
      expect(Math.abs(engine["carA"].group.position.x - engine["minigames"].stationStart().x), "the car is back on the hilltop").toBeLessThan(START_TOLERANCE);
      const samples = throwAndRead("longJump");
      expect(samples.length, "the retried run threw him").toBeGreaterThan(0);
      expect(minigameHud().phase, "the retried run scored").toBe("scored");
      expect(minigameHud().noThrow, "a throw is no no throw").toBe(false);
    });
  });
});
