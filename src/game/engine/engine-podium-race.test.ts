import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import "../kernel/rapier-node.test-util.ts";
import { AI_EVERY_SLICE } from "../ai/constants.ts";
import { FRAME_HZ } from "../kernel/constants.ts";
import { HudStore } from "../hud/hud-store.ts";
import { TRACK_ID } from "../world/constants.ts";
import { setGround } from "../world/ground.ts";
import type { DeformableCar } from "../vehicle/car.ts";
import { PODIUM_BLOCKS } from "../match/podium.ts";
import type { RaceResultRow } from "../match/types.ts";
import { CrashEngine } from "./engine.ts";
import { element, stubBrowser } from "./engine-headless.test-util.ts";

const FRAME = 1 / FRAME_HZ;
/** The race's rules: one lap, three rivals, no police (the field of four is the podium's three and one more). */
const RULES = { trackId: TRACK_ID.city, laps: 1, aiCount: 3, police: false, aggression: 0.5, aiDifficulty: AI_EVERY_SLICE, spectate: false, noReset: false };
/** A dent, in metres, on the body's skin that the podium's car must carry (the net state is float32 on the wire: a few millimetres). */
const SAME_SKIN_M = 0.005;
const DENT_M = 0.04;
/** Sparks within this of the stand's middle (m) are the podium's own jets': the course's finish-line fountains play far below. */
const PLATFORM_REACH_M = 16;

const bodyOf = (car: DeformableCar): Float32Array => Float32Array.from(car.lookMeshes().body.geometry.getAttribute("position").array);

function skinGap(a: Float32Array, b: Float32Array): number {
  assert.equal(a.length, b.length, "the same body mesh");
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

type Part = DeformableCar["parts"][number];
/** A part's place, turn and scale on the car. */
const poseOf = (p: Part): number[] => [...p.object.position.toArray(), ...p.object.quaternion.toArray(), ...p.object.scale.toArray()];

/** What a part shows: torn off the car, or on it and posed. */
type PartState = { detached: boolean; pose: number[]; rest: number[] };

function partState(car: DeformableCar, p: Part): PartState {
  if (p.detached) return { detached: true, pose: [], rest: [] };
  // Hinged panels and bumpers flutter with the car's speed (`flapAngle`); the podium's cars stand still.
  car.flapSpeed = 0;
  car["posePart"](p);
  return { detached: false, pose: poseOf(p), rest: [...p.restPos.toArray(), ...p.restQuat.toArray(), 1, 1, 1] };
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

  before(async () => {
    stubBrowser();
    engine = new CrashEngine(element(), new HudStore(), element());
    Object.assign(engine["renderer"], { render() {}, compile() {}, compileAsync: () => Promise.resolve() });
    await engine.ready;
    engine.fadeScenes = false;
    engine.toggleRace();
    engine.raceCommand({ type: "program", options: RULES });
    engine.raceCommand({ type: "start" });
    run(5);
    // Every racer takes a hard hit on its front left corner (a hub shoved) and loses what `wreck` takes; then the race is closed where it stands.
    for (const car of live().slice(0, 4)) {
      const corner = car.group.localToWorld(new THREE.Vector3(-0.7, 0.4, 2.2));
      car.applyImpact(corner, car.forward.clone().negate(), CORNER_HIT_MPS, CORNER_HIT_EBS);
    }
    run(1);
    for (const [k, car] of live().slice(0, 4).entries()) wreck(car, k);
    engine.raceCommand({ type: "end" });
    // One frame: the podium reads the cars in the frame that sees the race finished.
    run(FRAME);
    results = race().hud().results ?? [];
    for (const row of results) {
      const car = live()[row.id]!;
      skinsAtTheFinish.set(row.id, bodyOf(car));
      lostAtTheFinish.set(row.id, car["looseWheels"].filter((w) => w.loose).length);
      partsAtTheFinish.set(row.id, car["parts"].map((p) => partState(car, p)));
      wheelSeatsAtTheFinish.set(
        row.id,
        car["wheels"].map((w, i) => (car["looseWheels"][i]!.loose ? null : w.position.clone())),
      );
    }
    // The results reel respawns the field's cars from its clips: stand in for it, so a podium that read the live cars would show none of the damage.
    for (const car of live()) car.spawnFacing(0, 0, 0, 0);
    engine.raceCommand({ type: "podium", on: true });
    run(0.2);
  });
  after(() => {
    engine.dispose();
    setGround(null);
  });

  it("when the podium is up, then its cars are the first three of the results, in order, named as the results name them", () => {
    assert.ok(results.length >= 4, "the control: a field of four was classified");
    const standing = [...engine["podium"].cars()];
    assert.equal(standing.length, 3);
    for (const [k, car] of standing.entries()) assert.equal(car.group.userData.carIndex, results[k]!.id, `place ${k + 1}`);
    assert.equal(podiumHud()?.kind, "race");
    for (const [k, row] of results.slice(0, 3).entries()) assert.equal(podiumHud()?.names[k], row.name, `name of place ${k + 1}`);
  });

  it("when the three cars are measured, then the winner's is on the highest block in the middle, the second's lower on the left, the third's lowest on the right", () => {
    const spot = race().podiumSpot()!;
    const cars = engine["podium"].cars();
    const [first, second, third] = [cars[0]!.group.position, cars[1]!.group.position, cars[2]!.group.position];
    assert.ok(first.y > second.y && second.y > third.y, `heights ${first.y} > ${second.y} > ${third.y}`);
    assert.ok(second.x < first.x && first.x < third.x, `places ${second.x} < ${first.x} < ${third.x}`);
    assert.equal(first.x, spot.x + PODIUM_BLOCKS[0]!.x);
    assert.equal(first.y, spot.y + PODIUM_BLOCKS[0]!.top);
  });

  it("when each car's skin is read, then it is the dented skin its racer's car had when the race ended, though the field's cars have since been put back", () => {
    const standing = [...engine["podium"].cars()];
    for (const [k, car] of standing.entries()) {
      const id = results[k]!.id;
      const wanted = skinsAtTheFinish.get(id)!;
      assert.ok(skinGap(bodyOf(car), wanted) <= SAME_SKIN_M, `place ${k + 1}: the podium's car is ${skinGap(bodyOf(car), wanted)} m from the finish's skin`);
      assert.ok(skinGap(bodyOf(live()[id]!), wanted) >= DENT_M, `place ${k + 1}, the control: the field's car, put back, is a dent away from it`);
    }
  });

  it("when each podium car's kept wheels are read, then each sits where the finished car's did along the ground (at its hub, in its crushed car), not on its rest seat", () => {
    let checked = 0;
    for (const [k, car] of [...engine["podium"].cars()].entries()) {
      const seats = wheelSeatsAtTheFinish.get(results[k]!.id)!;
      for (const [i, wheel] of car["wheels"].entries()) {
        const want = seats[i];
        if (!want) continue;
        // Along the ground only: the seat's height is the suspension's ride, which a car standing level has at rest.
        const gap = Math.hypot(wheel.position.x - want.x, wheel.position.z - want.z);
        assert.ok(gap <= WHEEL_SEAT_TOLERANCE, `place ${k + 1}, wheel ${i}: ${wheel.position.toArray()} against the finish's ${want.toArray()}`);
        checked++;
      }
    }
    assert.ok(checked > 0, "the control: some kept wheel was compared");
  });

  it("when the wheel batch draws the podium's cars, then every wheel they kept is drawn and none they lost is", () => {
    const lost = [...engine["podium"].cars()].map((_, k) => lostAtTheFinish.get(results[k]!.id)!);
    assert.ok(
      lost.some((n) => n > 0),
      "the control: a podium car lost a wheel",
    );
    // The renderer's pre-draw hook, run by hand: the stubbed renderer draws nothing.
    const scene = engine["scene"];
    scene.onBeforeRender(engine["renderer"], scene, engine["camera"], new THREE.BufferGeometry(), new THREE.MeshBasicMaterial(), new THREE.Group());
    const drawn = engine["wheels"]["near"].mesh.count + engine["wheels"]["far"].mesh.count;
    assert.equal(drawn, lost.reduce((total, n) => total + 4 - n, 0), "wheels drawn: four a car less the ones it lost");
    assert.ok(drawn > 0, "the control: some wheels are drawn");
  });

  it("when each podium car's doors, hood, bumpers and mirrors are read against the car as it finished, then the attached ones sit in the same pose and the torn ones are absent", () => {
    let open = 0;
    let torn = 0;
    for (const [k, car] of [...engine["podium"].cars()].entries()) {
      const finish = partsAtTheFinish.get(results[k]!.id)!;
      assert.equal(car["parts"].length, finish.length, `place ${k + 1}: the same parts`);
      for (const [i, p] of car["parts"].entries()) {
        const want = finish[i]!;
        assert.equal(p.detached, want.detached, `place ${k + 1}, ${p.name}: torn off as the car finished`);
        if (want.detached) {
          torn++;
          assert.equal(p.object.visible, false, `place ${k + 1}, ${p.name}: a torn part is not drawn`);
          continue;
        }
        const shown = poseOf(p);
        const tolerance = p.bumper ? BUMPER_HANG_TOLERANCE : POSE_TOLERANCE;
        for (const [n, value] of want.pose.entries()) assert.ok(Math.abs(shown[n]! - value) <= tolerance, `place ${k + 1}, ${p.name}: pose component ${n} is ${shown[n]}, the finish's ${value}`);
        if (want.pose.some((value, n) => Math.abs(value - want.rest[n]!) > OFF_REST)) open++;
      }
    }
    assert.ok(open > 0, "the control: some attached part is posed away from its rest");
    assert.ok(torn > 0, "the control: some part is torn off");
  });

  it("when the podium is up, then the field's cars are hidden, the podium's own are not the field's, and the camera is up over the course on the stand", () => {
    const standing = [...engine["podium"].cars()];
    assert.ok(
      live().every((c) => !c.group.visible),
      "the field is hidden",
    );
    assert.ok(
      standing.every((c) => c.group.visible && !live().includes(c)),
      "three cars of its own",
    );
    assert.equal(engine["highlights"].playing, true);
    assert.equal(engine["cameraRig"](), "podium");
    assert.ok(engine["camera"].position.y > race().podiumSpot()!.y, "over the platform");
  });

  it("when the podium has been up for ten seconds at the high tier, then sparks are in the air over the platform and they move from one frame to the next", () => {
    // No sky: the high tier would fetch its strip from a URL the headless page has none of.
    engine.setSky("off");
    engine["cine"].setTier("high");
    run(10);
    const spot = race().podiumSpot()!;
    const sys = engine["fountains"].jets;
    const overPlatform = (i: number): boolean => Math.hypot(sys["pos"][i * 3]! - spot.x, sys["pos"][i * 3 + 2]! - spot.z) < PLATFORM_REACH_M && sys["pos"][i * 3 + 1]! > spot.y - 1;
    const inAir = (): number[] => [...sys["life"].keys()].filter((i) => sys["life"][i]! > 0 && overPlatform(i));
    const before = inAir();
    assert.ok(before.length > 0, "the control: the podium's jets have sparks in the air");
    const lifeBefore = new Map(before.map((i) => [i, sys["life"][i]!]));
    run(0.1);
    const aged = before.filter((i) => sys["life"][i]! < lifeBefore.get(i)!);
    assert.ok(aged.length > 0, "the jets update while the podium shows: the sparks in the air are not frozen");
  });

  it("when Skip is pressed, then the podium is down, the field is back as it was and the sheet's cars are not the podium's", () => {
    engine.raceCommand({ type: "podium", on: false });
    run(0.1);
    assert.equal(podiumHud(), null);
    assert.equal(engine["highlights"].playing, false);
    assert.ok(
      live().every((c) => c.group.visible),
      "the field is drawn again",
    );
    assert.equal(engine["podium"].cars().length, 0, "no podium car is standing");
  });

  it("when the podium is raised a second time, then it shows the same three", () => {
    engine.raceCommand({ type: "podium", on: true });
    run(0.2);
    for (const [k, car] of [...engine["podium"].cars()].entries()) assert.equal(car.group.userData.carIndex, results[k]!.id, `place ${k + 1}`);
    engine.raceCommand({ type: "podium", on: false });
    run(0.1);
  });
});
