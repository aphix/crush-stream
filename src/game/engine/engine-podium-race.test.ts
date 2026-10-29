import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as THREE from "three";
import "../kernel/rapier-node.test-util.ts";
import { AI_EVERY_SLICE } from "../ai/constants.ts";
import { FRAME_HZ } from "../kernel/constants.ts";
import { TRACK_ID } from "../world/constants.ts";
import { setGround } from "../world/ground.ts";
import type { DeformableCar } from "../vehicle/car.ts";
import { PODIUM_BLOCKS } from "../match/podium.ts";
import { sparkAt, sparkLives } from "../present/fountain-sparks.test-util.ts";
import type { RaceResultRow } from "../match/types.ts";
import type { CrashEngine } from "./engine.ts";
import { bootEngine, stubBrowser } from "./engine-headless.test-util.ts";

const FRAME = 1 / FRAME_HZ;
/** The race's rules: one lap, three rivals, no police (the field of four is the podium's three and one more). */
const RULES = { trackId: TRACK_ID.city, laps: 1, aiCount: 3, police: false, aggression: 0.5, aiDifficulty: AI_EVERY_SLICE, spectate: false, noReset: false };
/** A dent, in metres, on the body's skin that the podium's car must carry (the net state is float32 on the wire: a few millimetres). */
const SAME_SKIN_M = 0.005;
const DENT_M = 0.04;
/** Sparks within this of the stand's middle (m) are the podium's own jets': the course's finish-line fountains play far below. */
const PLATFORM_REACH_M = 16;
/** Where each drawn frame sits inside its last step (`SimPacer.alpha`): half way, so the drawn skin is not the sim's. */
const DRAWN_ALPHA = 0.5;

const bodyOf = (car: DeformableCar): Float32Array => Float32Array.from(car.lookMeshes().body.geometry.getAttribute("position").array);

function skinGap(a: Float32Array, b: Float32Array): number {
  expect(a.length, "the same body mesh").toBe(b.length);
  let gap = 0;
  for (let i = 0; i < a.length; i++) gap = Math.max(gap, Math.abs(a[i]! - b[i]!));
  return gap;
}

const HUBS = ["hubFL", "hubFR", "hubRL", "hubRR"] as const;
/** Hinge values (rad) the wreck's hood and left door are forced to: clearly off rest. */
const HOOD_OPEN = 0.8;
const DOOR_SWING = 0.6;
/** A part's pose as the race left it: netplay's float32 and the hinge values' rounding. */
const POSE_TOLERANCE = 0.01;
/** A part's pose this far from rest (m, or a quaternion component) counts as shown open. */
const OFF_REST = 0.02;
/** A bumper hangs by its attach sensors' compression, solver state the net state lacks: the podium's stands straight (measured 4.6 cm and 0.04 off). */
const BUMPER_HANG_TOLERANCE = 0.06;
/** A kept wheel sits where the finished car's did (m): its hub's place in the crushed car. */
const WHEEL_SEAT_TOLERANCE = 0.01;
/** The corner hit every field car takes: closing speed (m/s) and equivalent barrier speed (`DeformableCar.applyImpact`). */
const CORNER_HIT_MPS = 28;
const CORNER_HIT_EBS = 24;
/** Height (m) of the corner hit: the front guard's, as the platform's wing stands. */
const CORNER_Y = 0.4;
/** A height (m) no road reaches: the car read at it has nothing under it to fit its doors and bumpers to. */
const CLEAR_OF_ROAD_M = 1000;
/** The racer that crosses the finish line before the race is closed, and is hit after it. */
const FINISHER = 0;

type Part = DeformableCar["parts"][number];
/** A part's place, turn and scale on the car. */
const poseOf = (p: Part): number[] => [...p.object.position.toArray(), ...p.object.quaternion.toArray(), ...p.object.scale.toArray()];

/** What a part shows: torn off the car, or on it and posed. */
type PartState = { detached: boolean; pose: number[]; rest: number[] };

function partState(car: DeformableCar, p: Part): PartState {
  if (p.detached) return { detached: true, pose: [], rest: [] };
  // Hinged panels and bumpers flutter with the car's speed (`flapAngle`); the podium's cars stand still.
  car.flapSpeed = 0;
  // The podium stands clear of the road: a door's lift off the road under a tilted finish is not a pose the level copy can show.
  car.group.position.y += CLEAR_OF_ROAD_M;
  car["posePart"](p);
  car.group.position.y -= CLEAR_OF_ROAD_M;
  car.group.updateMatrixWorld(true);
  return { detached: false, pose: poseOf(p), rest: [...p.restPos.toArray(), ...p.restQuat.toArray(), ...p.restScale.toArray()] };
}

/** Car `k` of the field's front four loses a wheel (not the third), has its hood and left door forced open, and cars 0 and 3 lose their front bumper. */
function wreck(car: DeformableCar, k: number): void {
  if (k !== 2) car["dropWheel"](k, HUBS[k]!);
  for (const p of car["parts"]) {
    if (p.hinge === "cowl") p.hingeT = HOOD_OPEN;
    if (p.hinge === "door" && p.name === "doorL") p.swing!.theta = DOOR_SWING;
    if ((k === 0 || k === 3) && p.bumper && p.hinge === "two-point" && p.name.includes("F")) car["detachPart"](p, 5);
  }
}

describe("given the real engine and a race ended with every car dented", () => {
  // One engine for the file: a second `CrashEngine` in the same process never resolves `ready`.
  let engine: CrashEngine;
  const race = () => engine["race"];
  const run = (seconds: number): void => engine.advance(seconds, { frameDt: FRAME });
  const live = () => engine["live"]();
  const podiumHud = () => engine["reelHud"]().podium;

  let results: RaceResultRow[] = [];
  const skinsAtTheFinish = new Map<number, Float32Array>();
  const lostAtTheFinish = new Map<number, number>();
  const partsAtTheFinish = new Map<number, PartState[]>();
  const wheelSeatsAtTheFinish = new Map<number, (THREE.Vector3 | null)[]>();
  let skinAtTheLine: Float32Array = new Float32Array(0);
  let skinAtTheEnd: Float32Array = new Float32Array(0);

  beforeAll(async () => {
    stubBrowser();
    engine = await bootEngine({ pacer: true });
    engine.pace.pin = true;
    const paceRun = engine.pace.run.bind(engine.pace);
    engine.pace.run = (...args: Parameters<typeof paceRun>) => {
      paceRun(...args);
      engine.pace.alpha = DRAWN_ALPHA;
    };
    engine.toggleRace();
    engine.raceCommand({ type: "program", options: RULES });
    engine.raceCommand({ type: "start" });
    run(5);
    // Every racer takes a hard hit on its front left corner (a hub shoved) and loses what `wreck` takes; then the race is closed where it stands.
    for (const car of live().slice(0, 4)) {
      // The car's own front left corner: its left hub's line, its cage's nose face.
      const corner = car.group.localToWorld(new THREE.Vector3(car.frame.wheels[0]![0], CORNER_Y, car.cage.fields.planBox[3]!));
      car.applyImpact(corner, car.forward.clone().negate(), CORNER_HIT_MPS, CORNER_HIT_EBS);
    }
    run(1);
    for (const [k, car] of live().slice(0, 4).entries()) wreck(car, k);
    // Car 0 crosses the line (its row finished as `RaceSession.pass` finishes one); the frame reads it. Then it is hit on its tail before the race closes.
    const session = race()["session"]!;
    const winner = session.cars.find((c) => c.id === FINISHER)!;
    winner.status = "finished";
    winner.finishTime = session.time;
    run(FRAME);
    // What the podium is checked against: a car's skin, lost wheels, parts and wheel seats as read now.
    const capture = (id: number): void => {
      const car = live()[id]!;
      skinsAtTheFinish.set(id, bodyOf(car));
      lostAtTheFinish.set(id, car["looseWheels"].filter((w) => w.loose).length);
      partsAtTheFinish.set(id, car["parts"].map((p) => partState(car, p)));
      wheelSeatsAtTheFinish.set(
        id,
        car["wheels"].map((_, i) => (car["looseWheels"][i]!.loose ? null : car.deform.massLocal(HUBS[i]!).clone())),
      );
    };
    capture(FINISHER);
    skinAtTheLine = skinsAtTheFinish.get(FINISHER)!;
    const late = live()[FINISHER]!;
    late.applyImpact(late.group.localToWorld(new THREE.Vector3(0, CORNER_Y, late.cage.fields.planBox[2]!)), late.forward.clone(), CORNER_HIT_MPS, CORNER_HIT_EBS);
    run(1);
    engine.raceCommand({ type: "end" });
    // One frame: the podium reads the cars that never finished in the frame that sees the race finished.
    run(FRAME);
    skinAtTheEnd = bodyOf(live()[FINISHER]!);
    results = race().hud().results ?? [];
    for (const row of results) if (row.id !== FINISHER) capture(row.id);
    // The results reel respawns the field's cars from its clips: stand in for it, so a podium that read the live cars would show none of the damage.
    for (const car of live()) car.spawnFacing(0, 0, 0, 0);
    engine.raceCommand({ type: "podium", on: true });
    run(0.2);
  });
  afterAll(() => {
    engine.dispose();
    setGround(null);
  });

  it("when the podium is up, then its cars are the first three of the results, in order, named as the results name them", () => {
    expect(results.length, "the control: a field of four was classified").toBeGreaterThanOrEqual(4);
    const standing = [...engine["podium"].cars()];
    expect(standing.length).toBe(3);
    for (const [k, car] of standing.entries()) expect(car.group.userData.carIndex, `place ${k + 1}`).toBe(results[k]!.id);
    expect(podiumHud()?.kind).toBe("race");
    for (const [k, row] of results.slice(0, 3).entries()) expect(podiumHud()?.names[k], `name of place ${k + 1}`).toBe(row.name);
  });

  it("when the three cars are measured, then the winner's is on the highest block in the middle, the second's lower on the left, the third's lowest on the right", () => {
    const spot = race().podiumSpot()!;
    const cars = engine["podium"].cars();
    const [first, second, third] = [cars[0]!.group.position, cars[1]!.group.position, cars[2]!.group.position];
    expect(first.y > second.y && second.y > third.y, `heights ${first.y} > ${second.y} > ${third.y}`).toBeTruthy();
    expect(second.x < first.x && first.x < third.x, `places ${second.x} < ${first.x} < ${third.x}`).toBeTruthy();
    expect(first.x).toBe(spot.x + PODIUM_BLOCKS[0]!.x);
    expect(first.y).toBe(spot.y + PODIUM_BLOCKS[0]!.top);
  });

  it("when each car's skin is read, then it is the dented skin its racer's car had as it crossed the finish line (or when the race ended, for one that never did), though the field's cars have since been put back", () => {
    expect(skinGap(skinAtTheEnd, skinAtTheLine), `the control: the hit after the line dents the finisher ${skinGap(skinAtTheEnd, skinAtTheLine)} m`).toBeGreaterThanOrEqual(DENT_M);
    const standing = [...engine["podium"].cars()];
    expect(standing.some((c) => c.group.userData.carIndex === FINISHER), "the control: the finisher is on the podium").toBeTruthy();
    for (const [k, car] of standing.entries()) {
      const id = results[k]!.id;
      const wanted = skinsAtTheFinish.get(id)!;
      expect(skinGap(bodyOf(car), wanted), `place ${k + 1}: the podium's car is ${skinGap(bodyOf(car), wanted)} m from the finish's skin`).toBeLessThanOrEqual(SAME_SKIN_M);
      expect(skinGap(bodyOf(live()[id]!), wanted), `place ${k + 1}, the control: the field's car, put back, is a dent away from it`).toBeGreaterThanOrEqual(DENT_M);
    }
  });

  it("when each podium car's kept wheels are read, then each sits where the finished car's did along the ground (at its hub, in its crushed car), not on its rest seat", () => {
    let checked = 0;
    for (const [k, car] of [...engine["podium"].cars()].entries()) {
      const seats = wheelSeatsAtTheFinish.get(results[k]!.id)!;
      for (const [i, wheel] of car["wheels"].entries()) {
        const want = seats[i];
        if (!want) continue;
        // Along the ground only: the podium's wheel stands on its hub mass's x and z (`followHubs`), not on the live car's suspension seat.
        const gap = Math.hypot(wheel.position.x - want.x, wheel.position.z - want.z);
        expect(gap, `place ${k + 1}, wheel ${i}: ${wheel.position.toArray()} against the finish's ${want.toArray()}`).toBeLessThanOrEqual(WHEEL_SEAT_TOLERANCE);
        checked++;
      }
    }
    expect(checked, "the control: some kept wheel was compared").toBeGreaterThan(0);
  });

  it("when the podium's cars are drawn, then every wheel they kept is drawn and none they lost is", () => {
    const lost = [...engine["podium"].cars()].map((_, k) => lostAtTheFinish.get(results[k]!.id)!);
    expect(lost.some((n) => n > 0), "the control: a podium car lost a wheel").toBeTruthy();
    // The renderer's pre-draw hook, run by hand: the stubbed renderer draws nothing.
    const scene = engine["scene"];
    scene.onBeforeRender(engine["renderer"], scene, engine["camera"], new THREE.BufferGeometry(), new THREE.MeshBasicMaterial(), new THREE.Group());
    const drawn = engine["wheels"].meshes.slice(0, -1).reduce((n, mesh) => n + mesh.count, 0);
    expect(drawn, "wheels drawn: four a car less the ones it lost").toBe(lost.reduce((total, n) => total + 4 - n, 0));
    expect(drawn, "the control: some wheels are drawn").toBeGreaterThan(0);
  });

  it("when each podium car's doors, hood, bumpers and mirrors are read against the car as it finished, then the attached ones sit in the same pose and the torn ones are absent", () => {
    let open = 0;
    let torn = 0;
    for (const [k, car] of [...engine["podium"].cars()].entries()) {
      const finish = partsAtTheFinish.get(results[k]!.id)!;
      expect(car["parts"].length, `place ${k + 1}: the same parts`).toBe(finish.length);
      for (const [i, p] of car["parts"].entries()) {
        const want = finish[i]!;
        expect(p.detached, `place ${k + 1}, ${p.name}: torn off as the car finished`).toBe(want.detached);
        if (want.detached) {
          torn++;
          expect(p.object.visible, `place ${k + 1}, ${p.name}: a torn part is not drawn`).toBe(false);
          continue;
        }
        const shown = poseOf(p);
        const tolerance = p.bumper ? BUMPER_HANG_TOLERANCE : POSE_TOLERANCE;
        for (const [n, value] of want.pose.entries()) expect(Math.abs(shown[n]! - value), `place ${k + 1}, ${p.name}: pose component ${n} is ${shown[n]}, the finish's ${value}`).toBeLessThanOrEqual(tolerance);
        if (want.pose.some((value, n) => Math.abs(value - want.rest[n]!) > OFF_REST)) open++;
      }
    }
    expect(open, "the control: some attached part is posed away from its rest").toBeGreaterThan(0);
    expect(torn, "the control: some part is torn off").toBeGreaterThan(0);
  });

  it("when the podium is up, then the field's cars are hidden, the podium's own are not the field's, and the camera is up over the course on the stand", () => {
    const standing = [...engine["podium"].cars()];
    expect(live().every((c) => !c.group.visible), "the field is hidden").toBeTruthy();
    expect(standing.every((c) => c.group.visible && !live().includes(c)), "three cars of its own").toBeTruthy();
    expect(engine["highlights"].playing).toBe(true);
    expect(engine["cameraRig"]()).toBe("podium");
    expect(engine["camera"].position.y, "over the platform").toBeGreaterThan(race().podiumSpot()!.y);
  });

  it("when the podium has been up for ten seconds at the high tier, then sparks are in the air over the platform and they move from one frame to the next", () => {
    // No sky: the high tier would fetch its strip from a URL the headless page has none of.
    engine.setSky("off");
    engine["cine"].setTier("high");
    run(10);
    const spot = race().podiumSpot()!;
    const sys = engine["fountains"].jets;
    const at = new THREE.Vector3();
    const overPlatform = (k: number): boolean => {
      sparkAt(sys, k, at);
      return Math.hypot(at.x - spot.x, at.z - spot.z) < PLATFORM_REACH_M && at.y > spot.y - 1;
    };
    const inAir = (): number[] => [...sparkLives(sys).keys()].filter((k) => sparkLives(sys)[k]! > 0 && overPlatform(k));
    const before = inAir();
    expect(before.length, "the control: the podium's jets have sparks in the air").toBeGreaterThan(0);
    const heightBefore = new Map(before.map((k) => [k, sparkAt(sys, k, at).y]));
    run(0.1);
    const moved = before.filter((k) => sparkLives(sys)[k]! > 0 && sparkAt(sys, k, at).y !== heightBefore.get(k));
    expect(moved.length, "the jets update while the podium shows: the sparks in the air are not frozen").toBeGreaterThan(0);
  });

  it("when Skip is pressed, then the podium is down, the field is back as it was and the sheet's cars are not the podium's", () => {
    engine.raceCommand({ type: "podium", on: false });
    run(0.1);
    expect(podiumHud()).toBe(null);
    expect(engine["highlights"].playing).toBe(false);
    expect(live().every((c) => c.group.visible), "the field is drawn again").toBeTruthy();
    expect(engine["podium"].cars().length, "no podium car is standing").toBe(0);
  });

  it("when the podium is raised a second time, then it shows the same three", () => {
    engine.raceCommand({ type: "podium", on: true });
    run(0.2);
    for (const [k, car] of [...engine["podium"].cars()].entries()) expect(car.group.userData.carIndex, `place ${k + 1}`).toBe(results[k]!.id);
    engine.raceCommand({ type: "podium", on: false });
    run(0.1);
  });
});
