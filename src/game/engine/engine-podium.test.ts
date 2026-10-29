import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { DeformableCar } from "../vehicle/car.ts";
import { FINE_HZ } from "../kernel/constants.ts";
import { fleetStyle } from "../scenes/fleet.ts";
import { BLOCK_DEPTH, BLOCK_WIDTH, PODIUM_BLOCKS, type PodiumPlace } from "../match/podium.ts";
import { CarDamage } from "./car-damage.ts";
import { NOW, PodiumDirector, type PodiumHost } from "./engine-podium.ts";
import { stubBrowser } from "./engine-headless.test-util.ts";
import { firstMismatch } from "../kernel/compare-arrays.test-util.ts";

stubBrowser();

const SPOT = { x: 120, y: 55, z: -30 };
/** Net state is float32 on the wire: the dents come back to a few millimetres. */
const SAME_SKIN_M = 0.005;
/** A 4 cm dent or deeper: the damage the control car must show for "damaged" to mean something. */
const DENT_M = 0.04;
const PLACES: PodiumPlace[] = [
  { id: 0, name: "Ayla", place: 1 },
  { id: 1, name: "Bo", place: 2 },
  { id: 2, name: "Cy", place: 3 },
];

const bodyOf = (car: DeformableCar): Float32Array => Float32Array.from(car.lookMeshes().body.geometry.getAttribute("position").array);

/** The largest coordinate difference between two skins (m). */
function skinGap(a: Float32Array, b: Float32Array): number {
  expect(a.length, "the same body mesh").toBe(b.length);
  let gap = 0;
  for (let i = 0; i < a.length; i++) gap = Math.max(gap, Math.abs(a[i]! - b[i]!));
  return gap;
}

/** A host over a bare scene: real cars (fleet bodies), a donor wreck (shoved further by `shove`) standing in for racer 0's car as the race ended, its damage read as the race's end reads it (`FinalDamage.take`: the net state and the drawn body), and the fountain jets. */
function hostOver(scene: THREE.Scene, shove?: (donor: DeformableCar) => void) {
  const make = (id: number): DeformableCar => new DeformableCar({ body: 0x808080, accent: 0, name: `c${id}` }, scene, null, fleetStyle(id));
  const donor = make(0);
  donor.spawnFacing(0, 0, 0, 0);
  donor.applyImpact(new THREE.Vector3(0, 0.5, donor.cage.fields.planBox[3]!), new THREE.Vector3(0, 0, -1), 18, 14);
  for (let i = 0; i < 30; i++) donor.step(1 / FINE_HZ);
  shove?.(donor);
  donor.updateSkin();
  const damage = new CarDamage();
  damage.read(donor);
  damage.readDrawn(donor);
  const jets: { x: number; y: number; z: number; color: THREE.Color }[] = [];
  const host: PodiumHost = {
    spot: () => SPOT,
    carFor: (id, reuse) => reuse ?? make(id),
    dress: () => {},
    discard: (car) => scene.remove(car.group),
    damageOf: (id) => (id === 0 ? damage : null),
    scene,
    jet: (x, y, z, _in, _run, _power, color) => void jets.push({ x, y, z, color }),
  };
  return { host, donor, jets, make };
}

describe("given the podium raised over a course with three racers, the winner's car a wreck", () => {
  const scene = new THREE.Scene();
  const { host, donor, jets, make } = hostOver(scene);
  const director = new PodiumDirector(host);
  const wreckSkin = bodyOf(donor);
  expect(director.raise(PLACES, "race", "Test Oval"), "raised").toBeTruthy();
  director.time[NOW] = 0;
  director.frame();
  const cars = [...director.cars()];

  it("when the cars are read, then there is one per place and the winner's is first", () => {
    expect(cars.length).toBe(3);
    expect(director.focus(), "the sun's shadow follows the winner").toBe(cars[0]);
  });

  it("when each car's place is read, then it stands on its block's top, the stand's middle at the spot, nose turned as the block says", () => {
    for (const [k, block] of PODIUM_BLOCKS.entries()) {
      const p = cars[k]!.group.position;
      expect(p.x, `x of place ${block.place}`).toBe(SPOT.x + block.x);
      expect(p.z, `z of place ${block.place}`).toBe(SPOT.z);
      expect(p.y, `y of place ${block.place}`).toBe(SPOT.y + block.top);
      expect(Math.abs(cars[k]!.yaw - block.yaw), `yaw of place ${block.place}`).toBeLessThan(1e-9);
    }
  });

  it("when the three heights are compared, then the winner stands highest, the second lower and the third lowest", () => {
    const [first, second, third] = cars.map((c) => c.group.position.y) as [number, number, number];
    expect(first > second && second > third, `${first} > ${second} > ${third}`).toBeTruthy();
  });

  it("when the cars' footprints are measured, then each fits its block", () => {
    for (const [k, block] of PODIUM_BLOCKS.entries()) {
      const box = new THREE.Box3().setFromObject(cars[k]!.lookMeshes().body);
      expect(box.min.x >= SPOT.x + block.x - BLOCK_WIDTH / 2 - 0.3 && box.max.x <= SPOT.x + block.x + BLOCK_WIDTH / 2 + 0.3, `place ${block.place} across`).toBeTruthy();
      expect(box.min.z >= SPOT.z - BLOCK_DEPTH / 2 && box.max.z <= SPOT.z + BLOCK_DEPTH / 2, `place ${block.place} along`).toBeTruthy();
    }
  });

  it("when the winner's skin is read beside the wreck the race ended with, then it is that wreck's, and a fresh car's of the same body is not", () => {
    const shown = bodyOf(cars[0]!);
    expect(skinGap(shown, wreckSkin), `the winner's car is ${skinGap(shown, wreckSkin)} m from the wreck's skin`).toBeLessThanOrEqual(SAME_SKIN_M);
    expect(skinGap(bodyOf(make(0)), wreckSkin), "the control: an undamaged car of the wreck's own body is a dent away from the wreck").toBeGreaterThanOrEqual(DENT_M);
  });

  it("when the HUD is read, then it names the three racers as the standings do", () => {
    const hud = director.hud(2);
    if (!hud) throw new Error("the HUD is up while the stage is raised");
    expect(hud.kind, "HUD kind").toBe("race");
    expect(firstMismatch(hud.names, ["Ayla", "Bo", "Cy"]), "HUD names").toBeUndefined();
    expect(hud.reel, "HUD reel").toBe(2);
  });

  it("when ten seconds are drawn, then the fountains fire a round of four jets every three seconds from the platform", () => {
    jets.length = 0;
    for (let f = 1; f <= 600; f++) {
      director.time[NOW] = f / 60;
      director.frame();
    }
    expect(jets.length, "rounds at 3, 6 and 9 s (the one at the start went before)").toBe(4 * 3);
    for (const jet of jets) expect(jet.y, "from the platform's top").toBe(SPOT.y);
    expect(new Set(jets.map((j) => j.color.getHex())).size, "in more than one colour").toBeGreaterThan(1);
  });

  it("when it is lowered, then the stand and its cars are gone, and the HUD has nothing to draw", () => {
    director.lower();
    expect(director.open).toBe(false);
    expect(director.hud(0)).toBe(null);
    expect(firstMismatch(cars.map((c) => c.group.visible), [false, false, false])).toBeUndefined();
    expect(director.cars().length).toBe(0);
  });

  it("when it is raised again with a racer fewer, then the stand holds two", () => {
    expect(director.raise(PLACES.slice(0, 2), "campaign", "Championship")).toBeTruthy();
    expect(director.cars().length).toBe(2);
    expect(director.hud(0)?.kind).toBe("campaign");
  });
});

describe("given the camera round the podium", () => {
  const scene = new THREE.Scene();
  const { host } = hostOver(scene);
  const director = new PodiumDirector(host);
  director.raise(PLACES, "race", "Test Oval");
  const corners = PODIUM_BLOCKS.flatMap((b) => [-1, 1].map((side) => new THREE.Vector3(SPOT.x + b.x + (side * BLOCK_WIDTH) / 2, SPOT.y + b.top, SPOT.z)));
  const shapes = [
    { it: "a landscape desktop", aspect: 16 / 9 },
    { it: "an ultrawide", aspect: 21 / 9 },
    { it: "a phone on its side", aspect: 19.5 / 9 },
    { it: "a phone upright", aspect: 9 / 19.5 },
    { it: "a square tablet", aspect: 1 },
  ];

  it("when it swings over a minute on each screen shape, then the whole stand stays in view and the camera stays above the platform", () => {
    for (const shape of shapes) {
      const camera = new THREE.PerspectiveCamera(60, shape.aspect, 0.1, 2000);
      director.time[NOW] = 0;
      director.frame();
      for (let f = 0; f <= 3600; f += 20) {
        director.time[NOW] = f / 60;
        director.frame();
        director.aim(camera);
        camera.updateMatrixWorld(true);
        expect(camera.position.y, `${shape.it} at ${f / 60} s: the eye is over the platform`).toBeGreaterThan(SPOT.y);
        for (const p of corners) {
          const ndc = p.clone().project(camera);
          expect(Math.abs(ndc.x) <= 1 && ndc.z < 1, `${shape.it} at ${f / 60} s: a block's top corner is out of view (ndc ${ndc.x.toFixed(2)})`).toBeTruthy();
        }
      }
    }
  });

  it("when it swings, then the middle of the stand stays in the middle of the view", () => {
    const camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 2000);
    const middle = new THREE.Vector3(SPOT.x, SPOT.y + 2.8, SPOT.z);
    for (let f = 0; f <= 3600; f += 60) {
      director.time[NOW] = f / 60;
      director.frame();
      director.aim(camera);
      camera.updateMatrixWorld(true);
      const ndc = middle.clone().project(camera);
      expect(Math.abs(ndc.x) < 1e-6 && Math.abs(ndc.y) < 1e-6, `at ${f / 60} s the middle is at ndc (${ndc.x}, ${ndc.y})`).toBeTruthy();
    }
  });

  it("when it swings, then the eye stays on the viewer's side of the banner (in front of the blocks)", () => {
    const camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 2000);
    for (let f = 0; f <= 3600; f += 20) {
      director.time[NOW] = f / 60;
      director.frame();
      director.aim(camera);
      expect(camera.position.z, `at ${f / 60} s the eye is at z ${camera.position.z - SPOT.z} from the stand`).toBeGreaterThan(SPOT.z + BLOCK_DEPTH / 2);
    }
  });
});

/** How far the crash shoved the wreck's rear left hub along the car's x (m). */
const HUB_SHOVE_M = 0.25;
/** A wheel sits on its hub's place to this (m). */
const SEAT_TOLERANCE_M = 0.005;

describe("given a wreck whose rear left hub the crash shoved off its rest seat", () => {
  const { host } = hostOver(new THREE.Scene(), (donor) => void (donor.deform.massLocal("hubRL").x += HUB_SHOVE_M));
  const director = new PodiumDirector(host);
  director.raise(PLACES.slice(0, 1), "race", "Test Oval");
  const car = director.cars()[0]!;

  it("when the podium car's wheels are read, then the wheel of the shoved hub sits on that hub, off its rest seat, and the wheel of a hub that stayed sits on it", () => {
    const shoved = car.deform.massLocal("hubRL");
    const rest = car.frame.wheels[2]!;
    expect(Math.abs(shoved.x - rest[0]), `the control: the shove survived the net state (hub at x ${shoved.x}, rest ${rest[0]})`).toBeGreaterThan(HUB_SHOVE_M / 2);
    const wheel = car["wheels"][2]!;
    expect(Math.abs(wheel.position.x - shoved.x), `the wheel is at x ${wheel.position.x}, its hub at ${shoved.x}`).toBeLessThanOrEqual(SEAT_TOLERANCE_M);
    expect(Math.abs(wheel.position.z - shoved.z), `the wheel is at z ${wheel.position.z}, its hub at ${shoved.z}`).toBeLessThanOrEqual(SEAT_TOLERANCE_M);
    const kept = car.deform.massLocal("hubFR");
    expect(Math.abs(car["wheels"][1]!.position.x - kept.x), "the front right wheel is on its hub").toBeLessThanOrEqual(SEAT_TOLERANCE_M);
  });
});
