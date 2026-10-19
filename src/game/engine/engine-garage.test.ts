import { setImmediate } from "node:timers/promises";
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import "../kernel/rapier-node.test-util.ts";
import { HudStore } from "../hud/hud-store.ts";
import { FRAME_HZ } from "../kernel/constants.ts";
import { ORBIT_RADIUS } from "../present/engine-camera.ts";
import { GARAGE } from "../present/garage-art.ts";
import { PARTS } from "../present/ragdoll-body.ts";
import { setGround } from "../world/ground.ts";
import { CrashEngine } from "./engine.ts";
import { element, stubBrowser } from "./engine-headless.test-util.ts";

const FRAME = 1 / FRAME_HZ;
/** The scenes the garage is entered from: the fleet's car driven (its chase cam on), a mini game's followed, a race's field of eight. */
const ENTRIES = ["fleet", "driving", "minigame", "race"] as const;
/** How far (m) an eye may move and still be "put": float noise, nothing a person sees. */
const STILL = 1e-6;

describe("given the real engine in the garage", () => {
  // One engine for the file: a second `CrashEngine` in the same process never resolves `ready`.
  let engine: CrashEngine;
  let hud: HudStore;
  // The engine's canvas takes real pointer and wheel events: the camera's own handlers zoom.
  const canvas = element();
  const events = new EventTarget();
  Object.assign(canvas, { addEventListener: events.addEventListener.bind(events), removeEventListener: events.removeEventListener.bind(events), dispatchEvent: events.dispatchEvent.bind(events), setPointerCapture() {} });
  const run = (seconds: number): void => {
    for (let i = 0; i < Math.round(seconds * FRAME_HZ); i++) engine.advance(FRAME, { frameDt: FRAME });
  };
  /** Into the garage from `from` as the bar goes: through the scene fade, whose switch lands mid-frame, after the input poll. */
  const enter = async (from: (typeof ENTRIES)[number]): Promise<void> => {
    engine["setScene"]("fleet");
    if (from === "minigame") {
      engine["setScene"]("range");
      engine.startMinigame("highJump");
    }
    if (from === "race") engine["setScene"]("race");
    if (from === "driving") {
      engine["seat"].focus(0);
      engine["seat"].mode = "drive";
      run(1);
    }
    run(FRAME);
    engine.fadeScenes = true;
    engine["setScene"]("garage");
    // The fade holds black while the garage's programs warm: their promises settle between frames.
    for (let i = 0; i < 10 * FRAME_HZ && (engine["sceneId"] !== "garage" || engine["sceneFade"].pending !== null); i++) {
      run(FRAME);
      await setImmediate();
    }
    engine.fadeScenes = false;
    run(FRAME);
  };
  const eye = (): THREE.Vector3 => engine["camera"].position.clone();
  const look = (): THREE.Vector3 => engine["view"].look.clone();
  const radius = (): number => engine["view"]["radius"];
  const wheelIn = (): void => {
    for (let i = 0; i < 60; i++) canvas.dispatchEvent(Object.assign(new Event("wheel"), { deltaY: -200 }));
  };
  const pointer = (type: string, id: number, x: number): void => {
    canvas.dispatchEvent(Object.assign(new Event(type), { button: 0, pointerId: id, clientX: x, clientY: 300 }));
  };
  /** Two fingers spread from 20 px to 700 px apart. */
  const pinchOut = (): void => {
    pointer("pointerdown", 1, 50);
    pointer("pointerdown", 2, 70);
    for (let x = 90; x <= 750; x += 20) pointer("pointermove", 2, x);
    pointer("pointerup", 2, 750);
    pointer("pointerup", 1, 50);
  };

  before(async () => {
    stubBrowser();
    hud = new HudStore();
    engine = new CrashEngine(canvas, hud, element());
    Object.assign(engine["renderer"], { render() {}, compile() {}, compileAsync: () => Promise.resolve() });
    await engine.ready;
    engine.fadeScenes = false;
  });
  after(() => {
    engine.dispose();
    setGround(null);
  });

  it("when it is entered from the fleet (driving or not), a mini game or a race, then it opens on its shot and the eye stays put idle, and a tap on the car, W and View leave the seat on the whole set and the eye and the car where they were", async () => {
    for (const from of ENTRIES) {
      await enter(from);
      assert.equal(engine["sceneId"], "garage", from);
      const opening = eye();
      const { lookX, lookY, lookZ, radius: r, pitch } = GARAGE.shot;
      const shot = new THREE.Vector3(lookX + Math.sin(GARAGE.angle) * r * Math.cos(pitch), lookY + r * Math.sin(pitch), lookZ + Math.cos(GARAGE.angle) * r * Math.cos(pitch));
      assert.ok(opening.distanceTo(shot) < STILL, `${from}: the eye opens ${opening.distanceTo(shot).toFixed(3)} m off the garage's shot`);
      assert.ok(look().distanceTo(new THREE.Vector3(lookX, lookY, lookZ)) < STILL, `${from}: the orbit circles ${look().toArray().map((v) => v.toFixed(2)).join(", ")}, not the garage's shot`);
      run(5);
      assert.ok(eye().distanceTo(opening) < STILL, `${from}: the idle eye moved ${eye().distanceTo(opening).toFixed(3)} m in 5 s`);
      engine.watchCar(0);
      engine["keys"].add("KeyW");
      run(0.5);
      engine["keys"].clear();
      engine.cycleCamera();
      run(0.5);
      assert.equal(engine["seat"].mode, "global", `${from}: the seat`);
      assert.equal(engine["view"].flying, false, `${from}: View flew the eye free`);
      assert.equal(hud.get().cam, null, `${from}: the HUD names a camera`);
      assert.ok(eye().distanceTo(opening) < STILL, `${from}: the tap, W and View moved the eye ${eye().distanceTo(opening).toFixed(3)} m`);
      assert.ok(engine["carA"].group.position.length() < 0.01, `${from}: the car drove to ${engine["carA"].group.position.toArray().map((v) => v.toFixed(2)).join(", ")}`);
    }
  });

  it("when the driver is picked, then the orbit circles his torso as he is posed and keeps it there, and the car's pick puts it back on the car's shot", async () => {
    await enter("fleet");
    engine.frameGarage("person");
    run(1);
    // His torso's bone as drawn (translation, rotation: `DummyMesh.pose`), and the orbit's centre in its frame.
    const rows: Float32Array = engine["garage"]!.art.dummy["rows"];
    const turn = new THREE.Quaternion().fromArray(rows, 4);
    const local = look().sub(new THREE.Vector3().fromArray(rows, 0)).applyQuaternion(turn.invert()).sub(new THREE.Vector3(...PARTS[0].c));
    const [hx, hy, hz] = PARTS[0].h;
    assert.ok(Math.abs(local.x) <= hx && Math.abs(local.y) <= hy && Math.abs(local.z) <= hz, `the centre sits ${local.toArray().map((v) => v.toFixed(2)).join(", ")} m off his torso's middle, outside its box`);
    const centre = look();
    run(5);
    assert.ok(look().distanceTo(centre) < STILL, "the centre went back to the car");
    engine.frameGarage("car");
    run(FRAME);
    assert.ok(look().distanceTo(new THREE.Vector3(GARAGE.shot.lookX, GARAGE.shot.lookY, GARAGE.shot.lookZ)) < STILL, "the car's pick centres on the car's shot");
  });

  it("when the wheel or a pinch zooms in, then the orbit comes in to the garage's closest, and in the fleet no closer than before", async () => {
    await enter("fleet");
    wheelIn();
    assert.equal(radius(), GARAGE.minRadius, "the wheel");
    engine.frameGarage("car");
    pinchOut();
    assert.equal(radius(), GARAGE.minRadius, "a pinch");
    engine["setScene"]("fleet");
    run(FRAME);
    wheelIn();
    assert.equal(radius(), ORBIT_RADIUS.min, "the fleet's wheel");
  });

  it("when the fleet's cars are left for the garage, then the garage holds the player's car alone, and the fleet gets all of them back", async () => {
    await enter("fleet");
    const fleet = engine["sandboxCars"];
    assert.ok(fleet > 1, `the fleet has ${fleet} cars`);
    assert.equal(engine["cars"].length, 1, "cars in the garage");
    engine["setScene"]("fleet");
    run(FRAME);
    assert.equal(engine["cars"].length, fleet, "cars back in the fleet");
    assert.equal(engine["live"]().length, fleet, "and all of them shown");
  });
});
