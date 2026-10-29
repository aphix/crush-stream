import { afterAll, beforeAll, describe, it } from "vitest";
import assert from "node:assert/strict";
import * as THREE from "three";
import "../kernel/rapier-node.test-util.ts";
import { DummyMesh } from "../present/ragdoll-mesh.ts";
import { ROLE, ROW_TEXELS } from "../present/dummy-rig.ts";
import { SHOWCASE_EYE, SHOWCASE_LIGHT } from "../present/showcase-art.ts";
import { ELDER_LOOK } from "../present/dummy-dress.ts";
import { OUTFIT, type DriverLook } from "../present/driver-look.ts";
import { CAR_STYLE_IDS } from "../vehicle/car-variants.ts";
import { PART_KIND } from "../vehicle/part-geometry.ts";
import { setGround } from "../world/ground.ts";
import type { CrashEngine } from "./engine.ts";
import { runSeconds, bootEngine, stubBrowser } from "./engine-headless.test-util.ts";

/**
 * The showcase (`#scene=showcase`, by link only): every kind of person the game draws standing in rows in one draw, a press on
 * one knocks him into the ragdoll world as a car-struck guard goes, and behind them stand three rows of cars (as built, doors and
 * lids open, stripped) drawn but never stepped.
 */

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

  beforeAll(async () => {
    stubBrowser();
    globalThis.location.hash = "#scene=showcase";
    engine = await bootEngine();
    // Rapier loads in the background once the engine is ready: this is that load.
    await engine["ragdolls"].preload();
    runSeconds(engine, 0.5);
  });
  afterAll(() => {
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
    runSeconds(engine, 1);
    engine["ragdolls"].torso(slot, torso, null);
    assert.ok(torso.z < from.z - 1, `knocked away from the eye: ${from.z.toFixed(2)} to ${torso.z.toFixed(2)} m`);
    engine.reset();
    assert.equal(engine["ragdolls"]["dolls"][slot].live, false, "the dummy is gone");
    for (let s = 0; s < art().slots; s++) assert.ok(standing(s), `slot ${s} is back on its mark`);
  });

  it("when the set stands, then behind the people three rows of cars stand, one of each style in each: as built, every door and lid at its stop with the hood up on its rear edge, and every part and pane off, each with its cabin drawn and nobody in it", () => {
    const cars = engine["showcase"]!.cars;
    const styles = CAR_STYLE_IDS.length;
    assert.equal(cars.length, 3 * styles, "three rows of every style");
    for (let row = 0; row < 3; row++) assert.equal(new Set(cars.slice(row * styles, (row + 1) * styles).map((c) => c.style.id)).size, styles, `row ${row}: one of each style`);
    for (let k = 0; k < cars.length; k++) {
      const car = cars[k]!;
      const row = Math.floor(k / styles);
      const parts: { name: string; hinge: string; hingeT: number; detached: boolean; restQuat: THREE.Quaternion; object: { visible: boolean; quaternion: THREE.Quaternion } }[] = car["parts"];
      const hood = parts.find((p) => p.hinge === "cowl")!;
      const id = `row ${row} ${car.style.id}`;
      if (row === 0) assert.equal(`${car.doorAngle(-1)} ${car.doorAngle(1)} ${car.lidAngle()} ${hood.hingeT} ${parts.every((p) => !p.detached && p.object.visible)} ${car.glassPanes.every((g) => g.mesh.visible)}`, "0 0 0 0 true true", `${id}: as built`);
      if (row === 1) {
        const turned = THREE.MathUtils.radToDeg(hood.object.quaternion.angleTo(hood.restQuat));
        assert.equal(`${car.doorAngle(-1) === car.doorHinge(-1).spec.stop} ${car.doorAngle(1) === car.doorHinge(1).spec.stop} ${car.lidAngle() === car.lidHinge().spec.stop} ${hood.hingeT} ${turned >= 27 && turned <= 34} ${parts.every((p) => !p.detached)}`, "true true true 0 true true", `${id}: doors ${car.doorAngle(-1).toFixed(3)}/${car.doorAngle(1).toFixed(3)}, lid ${car.lidAngle().toFixed(3)} at their stops, the hood up ${turned.toFixed(1)} deg on its rear edge`);
      }
      if (row === 2) assert.equal(`${parts.filter((p) => !p.detached || p.object.visible).map((p) => p.name)} ${car.glassPanes.filter((g) => g.mesh.visible).length}`, " 0", `${id}: parts or panes still drawn`);
      assert.ok(car.group.visible && car.group.parent === engine["scene"], `${id}: in the scene`);
    }
    const batch = engine["partBatch"];
    batch.sync(engine["drawnCars"]());
    assert.equal(`${batch.drawn(PART_KIND.interior)} ${batch.drawn(PART_KIND.seatFront)} ${batch.drawn(PART_KIND.mirrorL)} ${batch.drawn(PART_KIND.liningL)} ${batch.drawn(PART_KIND.engineBay)}`, `${3 * styles} ${2 * 3 * styles} ${2 * styles} ${2 * styles} ${2 * styles}`, "every car's cabin and both front seats drawn; mirrors and door linings on the first two rows only; the bay under every open and stripped hood");
  });
});
