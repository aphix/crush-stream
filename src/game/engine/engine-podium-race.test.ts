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

describe("given the real engine and a race ended with every car dented", () => {
  // One engine for the file: a second `CrashEngine` in the same process never resolves `ready`.
  let engine: CrashEngine;
  const race = () => engine["race"];
  const run = (seconds: number): void => engine.advance(seconds, { frameDt: FRAME });
  const live = () => engine["live"]();
  const podiumHud = () => engine["reelHud"]().podium;

  let results: RaceResultRow[] = [];
  const skinsAtTheFinish = new Map<number, Float32Array>();

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
    // Every racer takes a head-on dent, then the race is closed where it stands.
    for (const car of live().slice(0, 4)) {
      const nose = car.group.localToWorld(new THREE.Vector3(0, 0.5, 2.2));
      car.applyImpact(nose, car.forward.clone().negate(), 18, 14);
    }
    run(1);
    engine.raceCommand({ type: "end" });
    run(0.1);
    results = race().hud().results ?? [];
    for (const row of results) skinsAtTheFinish.set(row.id, bodyOf(live()[row.id]!));
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
