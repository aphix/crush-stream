import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import "../kernel/rapier-node.test-util.ts";
import { HudStore } from "../hud/hud-store.ts";
import { DummyMesh } from "../present/ragdoll-mesh.ts";
import { ROLE, ROW_TEXELS } from "../present/dummy-rig.ts";
import { SHOWCASE_EYE, SHOWCASE_LIGHT } from "../present/showcase-art.ts";
import { ELDER_LOOK } from "../present/dummy-dress.ts";
import { OUTFIT, type DriverLook } from "../present/driver-look.ts";
import { setGround } from "../world/ground.ts";
import { CrashEngine } from "./engine.ts";
import { element, stubBrowser } from "./engine-headless.test-util.ts";
import { FRAME_HZ } from "../kernel/constants.ts";

/**
 * The showcase (`#scene=showcase`, by link only): every kind of person the game draws standing in rows in one draw, and a press on
 * one knocks him into the ragdoll world as a car-struck guard goes.
 */

const FRAME = 1 / FRAME_HZ;
const CHEST_Y = 1.2;
/** Each kind of person the set must show, by what tells him apart; `back` is a figure of the back row. */
const KINDS: readonly { name: string; is: (f: { cop: boolean; look: DriverLook; back: boolean }) => boolean }[] = [
  { name: "woman", is: (f) => f.look.woman },
  { name: "portly man", is: (f) => f.look.portly === true },
  { name: "cop", is: (f) => f.cop },
  { name: "capped man in shades", is: (f) => !f.cop && f.look.hat !== null && f.look.shades === true },
  { name: "plain-clothes guard", is: (f) => !f.cop && f.look.outfit === OUTFIT.UNIFORM && f.look.shades === true },
  { name: "older aide in the back row", is: (f) => f.back && f.look === ELDER_LOOK },
];

describe("given the real engine booted on #scene=showcase", () => {
  // One engine for the file: a second `CrashEngine` in the same process never resolves `ready`.
  let engine: CrashEngine;
  const run = (seconds: number): void => {
    for (let i = 0; i < seconds * FRAME_HZ; i++) engine.advance(FRAME, { frameDt: FRAME });
  };
  const art = () => engine["showcase"]!.art;
  const people = (): DummyMesh => art().people["mesh"];
  /** Whether figure `slot` is on the set. */
  const standing = (slot: number): boolean => ((people()["shown"] >> slot) & 1) === 1;
  /** Client coordinates (the stand-in canvas is 800 x 600) of figure `slot`'s chest in the camera now. */
  const chestOf = (slot: number): [number, number] => {
    const at = art().markOf(slot, new THREE.Vector3());
    at.y = CHEST_Y;
    engine["camera"].clearViewOffset();
    engine["camera"].aspect = 800 / 600;
    engine["camera"].updateProjectionMatrix();
    engine["camera"].updateMatrixWorld(true);
    at.project(engine["camera"]);
    return [((at.x + 1) / 2) * 800, ((1 - at.y) / 2) * 600];
  };

  before(async () => {
    stubBrowser();
    globalThis.location.hash = "#scene=showcase";
    engine = new CrashEngine(element(), new HudStore(), element());
    Object.assign(engine["renderer"], { render() {}, compile() {}, compileAsync: () => Promise.resolve() });
    await engine.ready;
    engine.fadeScenes = false;
    // Rapier loads in the background once the engine is ready: this is that load.
    await engine["ragdolls"].preload();
    run(0.5);
  });
  after(() => {
    engine.dispose();
    setGround(null);
  });

  it("when the page has loaded, then the showcase is the scene and every kind of person stands in one draw: a woman, a portly man, a cop, a capped man in shades, a plain-clothes guard and the older aide in the back row", () => {
    assert.equal(engine["sceneId"], "showcase");
    assert.equal(art().group.visible, true);
    const meshes: DummyMesh[] = [];
    art().group.traverse((o) => {
      if (o instanceof DummyMesh) meshes.push(o);
    });
    assert.equal(meshes.length, 1, "one instanced mesh draws them all");
    assert.equal(people().count, art().slots, "every slot is out");
    const figures = Array.from({ length: art().slots }, (_, slot) => ({ ...art().figureOf(slot), back: slot >= art().slots / 2 }));
    for (const kind of KINDS) assert.ok(figures.some(kind.is), `the ${kind.name} is on the set`);
    const drawn = (slot: number): number => {
      const at = new THREE.Vector3();
      let n = 0;
      for (let i = 0; i < people().geometry.getAttribute("position").count; i++) if (people().posed(slot, i, at)) n++;
      return n;
    };
    const kinds = new Set(Array.from({ length: art().slots / 2 }, (_, slot) => `${drawn(slot)}`));
    assert.ok(kinds.size >= 4, `the first row's six figures draw ${kinds.size} different bodies (man, woman, cap and shades, portly)`);
    for (let slot = 0; slot < art().slots; slot++) assert.ok(standing(slot), `slot ${slot} stands`);
  });

  it("when the set stands, then every figure faces the eye as the reference's line-up faces its camera, but the cop stands square to the line as the reference's does", () => {
    const rows: Float32Array = people()["rows"];
    const forward = new THREE.Vector3();
    const want = new THREE.Vector3();
    for (let slot = 0; slot < art().slots; slot++) {
      forward.set(0, 0, 1).applyQuaternion(new THREE.Quaternion().fromArray(rows, slot * ROW_TEXELS * 4 + 4));
      const at = art().markOf(slot, new THREE.Vector3());
      if (art().figureOf(slot).name === "uniformed cop") want.set(0, 0, 1);
      else want.set(SHOWCASE_EYE.x - at.x, 0, SHOWCASE_EYE.z - at.z).normalize();
      assert.ok(forward.angleTo(want) < 0.02, `slot ${slot} (${art().figureOf(slot).name}) turned ${forward.angleTo(want).toFixed(3)} rad off`);
    }
  });

  it("when the set is lit, then its key and its back light shine from their own places, and a light without them puts the day's sun and fill back where they always were", () => {
    const stage = engine["stage"];
    const key = () => stage.sun.position.clone().sub(stage.sun.target.position);
    const fill = stage["fill"].position;
    assert.ok(key().distanceTo(new THREE.Vector3(...SHOWCASE_LIGHT.sunAt)) < 1e-9, `the key at ${key().toArray()}`);
    assert.ok(fill.distanceTo(new THREE.Vector3(...SHOWCASE_LIGHT.fillAt)) < 1e-9, `the back light at ${fill.toArray()}`);
    stage.look(null);
    const [day, dayFill] = [key(), fill.clone()];
    stage.look(SHOWCASE_LIGHT);
    assert.ok(day.distanceTo(new THREE.Vector3(-10, 22, 9)) < 1e-9, `the day's sun at ${day.toArray()}`);
    assert.ok(dayFill.distanceTo(new THREE.Vector3(10, 12, -14)) < 1e-9, `the day's fill at ${dayFill.toArray()}`);
  });

  it("when the camera opens on the set, then it is the free eye in front of the first row, and a press on a figure is the scene's, not the camera's", () => {
    assert.equal(engine["view"].flying, true);
    assert.equal(engine["view"].take, engine["showcase"]);
    const [x, y] = chestOf(0);
    const miss = engine["view"].take!.down(x + 4000, y);
    assert.equal(miss, false, "a press far from every figure leaves the camera its drag");
    assert.equal(standing(0), true, "and knocks nobody over");
  });

  it("when a figure is pressed, then he leaves the set and the ragdoll world has him in his own dress, falling; and a reset stands everybody up again", () => {
    const dolls = (): number => engine["ragdolls"]["dolls"].filter((d: { live: boolean }) => d.live).length;
    const out = dolls();
    const [x, y] = chestOf(0);
    assert.equal(engine["view"].take!.down(x, y, 0), true);
    assert.equal(standing(0), false, "off the set");
    assert.equal(dolls(), out + 1, "in the ragdoll world");
    const slot = engine["ragdolls"]["lastSlot"];
    const shirt = engine["ragdolls"]["mesh"].colourOf(slot, ROLE.SHIRT, new THREE.Color()).getHexString();
    assert.equal(shirt, new THREE.Color(art().figureOf(0).look.shirt).getHexString(), "in the shirt he stood in");
    const torso = new THREE.Vector3();
    assert.equal(engine["ragdolls"].torso(slot, torso, null), true);
    const from = torso.clone();
    run(1);
    engine["ragdolls"].torso(slot, torso, null);
    assert.ok(torso.z < from.z - 1, `knocked away from the eye: ${from.z.toFixed(2)} to ${torso.z.toFixed(2)} m`);
    engine.reset();
    assert.equal(engine["ragdolls"]["dolls"][slot].live, false, "the dummy is gone");
    for (let s = 0; s < art().slots; s++) assert.ok(standing(s), `slot ${s} is back on its mark`);
  });
});
