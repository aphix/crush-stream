import { afterAll, beforeAll, describe, expect, it } from "vitest";
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
import { runSeconds, bootEngine, pressKey, stubBrowser } from "./engine-headless.test-util.ts";
import { SHOWCASE_THROWN, THROWN_KINDS, THROWN_PER_KIND } from "../present/showcase-art.ts";
import { FRAME_HZ } from "../kernel/constants.ts";

const FRAME = 1 / FRAME_HZ;

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
    return screenOf(at);
  };
  /** Client coordinates of world point `at` in the camera now. */
  const screenOf = (at: THREE.Vector3): [number, number] => {
    engine["camera"].clearViewOffset();
    engine["camera"].aspect = 800 / 600;
    engine["camera"].updateProjectionMatrix();
    engine["camera"].updateMatrixWorld(true);
    const p = at.clone().project(engine["camera"]);
    return [((p.x + 1) / 2) * 800, ((1 - p.y) / 2) * 600];
  };
  /** The cursor over client point (`x`, `y`), then number key `digit`. */
  const throwAt = ([x, y]: [number, number], digit: number): void => {
    engine["view"].hoverX = x;
    engine["view"].hoverY = y;
    pressKey(engine, `Digit${digit}`);
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
    expect(engine["sceneId"]).toBe("showcase");
    expect(art().group.visible).toBe(true);
    const meshes: DummyMesh[] = [];
    art().group.traverse((o) => {
      if (o instanceof DummyMesh) meshes.push(o);
    });
    expect(meshes.length, "one instanced mesh draws them all").toBe(1);
    expect(people().count, "every slot is out").toBe(art().slots);
    const figures = Array.from({ length: art().slots }, (_, slot) => ({ ...art().figureOf(slot), back: slot >= art().slots / 2 }));
    for (const kind of KINDS) expect(figures.some(kind.is), `the ${kind.name} is on the set`).toBeTruthy();
    const drawn = (slot: number): number => {
      const at = new THREE.Vector3();
      let n = 0;
      for (let i = 0; i < people().geometry.getAttribute("position").count; i++) if (people().posed(slot, i, at)) n++;
      return n;
    };
    const kinds = new Set(Array.from({ length: art().slots / 2 }, (_, slot) => `${drawn(slot)}`));
    expect(kinds.size, `the first row's six figures draw ${kinds.size} different bodies (man, woman, cap and shades, portly)`).toBeGreaterThanOrEqual(4);
    for (let slot = 0; slot < art().slots; slot++) expect(standing(slot), `slot ${slot} stands`).toBeTruthy();
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
      expect(forward.angleTo(want), `slot ${slot} (${art().figureOf(slot).name}) turned ${forward.angleTo(want).toFixed(3)} rad off`).toBeLessThan(0.02);
    }
  });

  it("when the set is lit, then its key and its back light shine from their own places, and a light without them puts the day's sun and fill back where they always were", () => {
    const stage = engine["stage"];
    const key = () => stage.sun.position.clone().sub(stage.sun.target.position);
    const fill = stage["fill"].position;
    expect(key().distanceTo(new THREE.Vector3(...SHOWCASE_LIGHT.sunAt)), `the key at ${key().toArray()}`).toBeLessThan(1e-9);
    expect(fill.distanceTo(new THREE.Vector3(...SHOWCASE_LIGHT.fillAt)), `the back light at ${fill.toArray()}`).toBeLessThan(1e-9);
    stage.look(null);
    const [day, dayFill] = [key(), fill.clone()];
    stage.look(SHOWCASE_LIGHT);
    expect(day.distanceTo(new THREE.Vector3(-10, 22, 9)), `the day's sun at ${day.toArray()}`).toBeLessThan(1e-9);
    expect(dayFill.distanceTo(new THREE.Vector3(10, 12, -14)), `the day's fill at ${dayFill.toArray()}`).toBeLessThan(1e-9);
  });

  it("when the camera opens on the set, then it is the free eye in front of the first row, and a press on a figure is the scene's, not the camera's", () => {
    expect(engine["view"].flying).toBe(true);
    expect(engine["view"].take).toBe(engine["showcase"]);
    const [x, y] = chestOf(0);
    const miss = engine["view"].take!.down(x + 4000, y, 0);
    expect(miss, "a press far from every figure leaves the camera its drag").toBe(false);
    expect(standing(0), "and knocks nobody over").toBe(true);
  });

  it("when a figure is pressed, then he leaves the set and the ragdoll world has him in his own dress, falling; and a reset stands everybody up again", () => {
    const dolls = (): number => engine["ragdolls"]["dolls"].filter((d: { live: boolean }) => d.live).length;
    const out = dolls();
    const [x, y] = chestOf(0);
    expect(engine["view"].take!.down(x, y, 0)).toBe(true);
    expect(standing(0), "off the set").toBe(false);
    expect(dolls(), "in the ragdoll world").toBe(out + 1);
    const slot = engine["ragdolls"]["lastSlot"];
    const shirt = engine["ragdolls"]["mesh"].colourOf(slot, ROLE.SHIRT, new THREE.Color()).getHexString();
    expect(shirt, "in the shirt he stood in").toBe(new THREE.Color(art().figureOf(0).look.shirt).getHexString());
    const torso = new THREE.Vector3();
    expect(engine["ragdolls"].torso(slot, torso, null)).toBe(true);
    const from = torso.clone();
    runSeconds(engine, 1);
    engine["ragdolls"].torso(slot, torso, null);
    expect(torso.z, `knocked away from the eye: ${from.z.toFixed(2)} to ${torso.z.toFixed(2)} m`).toBeLessThan(from.z - 1);
    engine.reset();
    expect(engine["ragdolls"]["dolls"][slot].live, "the dummy is gone").toBe(false);
    for (let s = 0; s < art().slots; s++) expect(standing(s), `slot ${s} is back on its mark`).toBeTruthy();
  });

  it("when the set stands, then behind the people three rows of cars stand, one of each style in each: as built, every door and lid at its stop with the hood up on its rear edge, and every part and pane off, each with its cabin drawn and nobody in it", () => {
    const cars = engine["showcase"]!.cars;
    const styles = CAR_STYLE_IDS.length;
    expect(cars.length, "three rows of every style").toBe(3 * styles);
    for (let row = 0; row < 3; row++) expect(new Set(cars.slice(row * styles, (row + 1) * styles).map((c) => c.style.id)).size, `row ${row}: one of each style`).toBe(styles);
    for (let k = 0; k < cars.length; k++) {
      const car = cars[k]!;
      const row = Math.floor(k / styles);
      const parts: { name: string; hinge: string; hingeT: number; detached: boolean; restQuat: THREE.Quaternion; object: { visible: boolean; quaternion: THREE.Quaternion } }[] = car["parts"];
      const hood = parts.find((p) => p.hinge === "cowl")!;
      const id = `row ${row} ${car.style.id}`;
      if (row === 0) expect(`${car.doorAngle(-1)} ${car.doorAngle(1)} ${car.lidAngle()} ${hood.hingeT} ${parts.every((p) => !p.detached && p.object.visible)} ${car.glassPanes.every((g) => g.mesh.visible)}`, `${id}: as built`).toBe("0 0 0 0 true true");
      if (row === 1) {
        const turned = THREE.MathUtils.radToDeg(hood.object.quaternion.angleTo(hood.restQuat));
        expect(`${car.doorAngle(-1) === car.doorHinge(-1).spec.stop} ${car.doorAngle(1) === car.doorHinge(1).spec.stop} ${car.lidAngle() === car.lidHinge().spec.stop} ${hood.hingeT} ${turned >= 27 && turned <= 34} ${parts.every((p) => !p.detached)}`, `${id}: doors ${car.doorAngle(-1).toFixed(3)}/${car.doorAngle(1).toFixed(3)}, lid ${car.lidAngle().toFixed(3)} at their stops, the hood up ${turned.toFixed(1)} deg on its rear edge`).toBe("true true true 0 true true");
      }
      if (row === 2) expect(`${parts.filter((p) => !p.detached || p.object.visible).map((p) => p.name)} ${car.glassPanes.filter((g) => g.mesh.visible).length}`, `${id}: parts or panes still drawn`).toBe(" 0");
      expect(car.group.visible && car.group.parent === engine["scene"], `${id}: in the scene`).toBeTruthy();
    }
    const batch = engine["partBatch"];
    batch.sync(engine["drawnCars"]());
    expect(`${batch.drawn(PART_KIND.interior)} ${batch.drawn(PART_KIND.seatFront)} ${batch.drawn(PART_KIND.mirrorL)} ${batch.drawn(PART_KIND.liningL)} ${batch.drawn(PART_KIND.engineBay)}`, "every car's cabin and both front seats drawn; mirrors and door linings on the first two rows only; the bay under every open and stripped hood").toBe(`${3 * styles} ${2 * 3 * styles} ${2 * styles} ${2 * styles} ${2 * styles}`);
  });

  it("when the cursor is over the floor and 2 is pressed, then the set's first crate flies from in front of the eye and comes down on that point", () => {
    engine.reset();
    runSeconds(engine, FRAME);
    const target = art().markOf(0, new THREE.Vector3()).lerp(engine["camera"].position.clone().setY(0), 0.5).setY(0);
    throwAt(screenOf(target), 2);
    const crate = THROWN_KINDS.indexOf("crate") * THROWN_PER_KIND;
    const p = new THREE.Vector3();
    const v = new THREE.Vector3();
    const out = SHOWCASE_THROWN.map((_, i) => engine["ragdolls"].propAt(i, p, v));
    expect(out.map((o, i) => (o ? SHOWCASE_THROWN[i]!.prefab : "")).filter(Boolean), "the props out").toEqual(["crate"]);
    expect(out[crate], "the kind's first").toBe(true);
    let nearest = Infinity;
    for (let f = 0; f < FRAME_HZ; f++) {
      runSeconds(engine, FRAME);
      engine["ragdolls"].propAt(crate, p, v);
      nearest = Math.min(nearest, Math.hypot(p.x - target.x, p.z - target.z));
    }
    expect(nearest, `its middle passed ${nearest.toFixed(2)} m from the point in plan`).toBeLessThan(0.5);
  });

  it("when a crate is thrown at a standing figure's chest, then he goes down; when a cone is thrown the same way, then it bounces off him and he stays on his feet", () => {
    /** Whether the figure in slot 0, a prop of key `digit` thrown at his chest, was knocked down within a second; and whether he left the set at all. */
    const hit = (digit: number): { down: boolean; met: boolean } => {
      engine.reset();
      runSeconds(engine, FRAME);
      throwAt(chestOf(0), digit);
      let down = false;
      let met = false;
      for (let f = 0; f < FRAME_HZ; f++) {
        runSeconds(engine, FRAME);
        const away: { figure: number; slot: number }[] = engine["showcase"]!["walks"]["away"];
        const him = away.find((a) => a.figure === 0);
        if (him === undefined) continue;
        met = true;
        down ||= engine["ragdolls"].walkers[him.slot]!.state === "down";
      }
      return { down, met };
    };
    const crate = hit(2);
    const cone = hit(1);
    expect(crate, "the crate (30 kg at 15 m/s: 3.4 m/s into his 101 kg)").toEqual({ down: true, met: true });
    expect(cone, "the cone (4 kg: 0.6 m/s, under the 1 m/s that knocks a man down)").toEqual({ down: false, met: true });
  });
});
