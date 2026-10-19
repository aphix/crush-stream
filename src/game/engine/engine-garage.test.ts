import { setImmediate } from "node:timers/promises";
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import "../kernel/rapier-node.test-util.ts";
import { HudStore } from "../hud/hud-store.ts";
import { SPRAY_PALETTE } from "../match/look-data.ts";
import { FRAME_HZ } from "../kernel/constants.ts";
import { ORBIT_RADIUS } from "../present/engine-camera.ts";
import { GARAGE } from "../present/garage-art.ts";
import { PARTS } from "../present/ragdoll-body.ts";
import { setGround } from "../world/ground.ts";
import { assertSameNumbers } from "../vehicle/test-support.ts";
import { PlayerLooks, type SprayTarget } from "./player-looks.ts";
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
  /** What a screen point shows: the car alone, the driver in front of the car, the driver behind it, or the driver alone. */
  type Under = "carOnly" | "driverFront" | "driverBehind" | "driverOnly";
  /** The first canvas point (20 px grid) whose ray from the eye as it stands meets `want`. The stand-in canvas has no size, so the view offset is cleared and the aspect set by hand (`frameField`). */
  const pointOver = (want: Under): { x: number; y: number } => {
    const camera = engine["camera"];
    const { width, height } = canvas.getBoundingClientRect();
    camera.clearViewOffset();
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    engine["scene"].updateMatrixWorld(true);
    camera.updateMatrixWorld(true);
    const m = engine["carA"].lookMeshes();
    const car = [m.body, m.hood, m.trunk, ...m.doors];
    const dummy = engine["garage"]!.art.dummy;
    const ray = new THREE.Raycaster();
    for (let y = 10; y < height; y += 20) {
      for (let x = 10; x < width; x += 20) {
        ray.setFromCamera(new THREE.Vector2((x / width) * 2 - 1, -(y / height) * 2 + 1), camera);
        const c = ray.intersectObjects(car, false)[0];
        const d = ray.intersectObjects([dummy], false)[0];
        const under: Under | null = c && !d ? "carOnly" : d && !c ? "driverOnly" : c && d ? (d.distance < c.distance ? "driverFront" : "driverBehind") : null;
        if (under === want) return { x, y };
      }
    }
    throw new Error(`no point shows ${want}`);
  };
  /**
   * A stroke of the can with `edit` picked, pressed over the first of `over` and dragged across the rest, the orbit turned to
   * `bearing` (rad) first when given: whether the press sprayed, and which bitmaps took paint.
   */
  const stroke = (edit: SprayTarget, over: readonly Under[], bearing?: number): { sprayed: boolean; car: boolean; person: boolean } => {
    engine.clearSpray("car");
    engine.clearSpray("person");
    engine.frameGarage(edit);
    if (bearing !== undefined) engine["view"]["angle"] = bearing;
    run(1);
    const [first, ...rest] = over.map(pointOver);
    const garage = engine["garage"]!;
    const sprayed = garage.down(first!.x, first!.y);
    for (const at of rest) garage.move({ clientX: at.x, clientY: at.y });
    garage.up();
    return { sprayed, car: engine["looks"].sprayOf("car").painted(), person: engine["looks"].sprayOf("person").painted() };
  };
  /** The orbit's bearing from the car's far side (-x): the car stands between the eye and the driver. */
  const FAR_SIDE = -Math.PI / 2;

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

  it("when the wheel or a pinch zooms in, then the orbit comes in to its shot's closest, the car's or the driver's, and in a race or the fleet no closer than before", async () => {
    await enter("fleet");
    wheelIn();
    assert.equal(radius(), GARAGE.shot.minRadius, "the wheel on the car's shot");
    engine.frameGarage("person");
    pinchOut();
    assert.equal(radius(), GARAGE.driverShot.minRadius, "a pinch on the driver's shot");
    engine["setScene"]("race");
    run(FRAME);
    wheelIn();
    assert.equal(radius(), ORBIT_RADIUS.min, "a race's wheel, straight from the driver's shot");
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

  it("when the can is on, then a stroke paints only what the panel edits: the other one drops out of the ray, so it never blocks or takes paint", async () => {
    await enter("fleet");
    engine.setSprayTool({ on: true });
    assert.deepEqual(stroke("person", ["carOnly", "carOnly"]), { sprayed: false, car: false, person: false }, "Driver picked, a stroke over the car");
    assert.deepEqual(stroke("person", ["driverBehind", "driverBehind"], FAR_SIDE), { sprayed: true, car: false, person: true }, "Driver picked, a stroke over him behind the car");
    assert.deepEqual(stroke("car", ["driverFront", "carOnly"]), { sprayed: true, car: true, person: false }, "Car picked, a stroke from him in front of the car across the car");
    assert.deepEqual(stroke("car", ["driverOnly", "driverOnly"]), { sprayed: false, car: false, person: false }, "Car picked, a stroke over him alone");
    engine.setSprayTool({ on: false });
  });

  it("when two strokes are sprayed on the car and one undone, then the bitmap and its save are the first stroke's exactly; redo puts the second back, a new stroke leaves nothing to redo, a clear is one step, and leaving the garage drops them", async () => {
    const saved = new Map<string, string>();
    Object.assign(globalThis, { localStorage: { getItem: (k: string) => saved.get(k) ?? null, setItem: (k: string, v: string) => saved.set(k, v), removeItem: (k: string) => saved.delete(k) } });
    await enter("fleet");
    engine.setSprayTool({ on: true });
    engine.frameGarage("car");
    run(1);
    const at = pointOver("carOnly");
    const garage = engine["garage"]!;
    const bitmap = engine["looks"].sprayOf("car");
    engine.clearSpray("car");
    /** A short stroke in `colour` over the car: the bitmap as drawn after it. */
    const spray = (colour: number): Uint8Array => {
      engine.setSprayTool({ colour });
      garage.down(at.x, at.y);
      garage.move({ clientX: at.x + 10, clientY: at.y });
      garage.up();
      return bitmap.rgba.slice();
    };
    /** The car's spray as the next visit draws it from storage. */
    const reloaded = (): Uint8Array => {
      const looks = new PlayerLooks();
      const rgba = looks.mine.carSpray.rgba.slice();
      looks.dispose();
      return rgba;
    };
    const first = spray(SPRAY_PALETTE[4]!);
    const second = spray(0x123456);
    assert.notEqual(Buffer.compare(first, second), 0, "the second stroke changed the bitmap");
    engine.undoSpray();
    assertSameNumbers(bitmap.rgba, first, "undone: the bitmap after the first stroke");
    assertSameNumbers(reloaded(), first, "undone: what storage keeps");
    assert.equal(hud.get().garage?.redo, 1, "one stroke to redo");
    engine.redoSpray();
    assertSameNumbers(bitmap.rgba, second, "redone: the bitmap after the second stroke");
    assertSameNumbers(reloaded(), second, "redone: what storage keeps");
    engine.undoSpray();
    const third = spray(SPRAY_PALETTE[10]!);
    engine.redoSpray();
    assertSameNumbers(bitmap.rgba, third, "a new stroke dropped the redo chain");
    engine.clearSpray("car");
    assert.equal(bitmap.painted(), false, "cleared");
    engine.undoSpray();
    assertSameNumbers(bitmap.rgba, third, "the clear undone");
    await enter("fleet");
    engine.undoSpray();
    assertSameNumbers(bitmap.rgba, third, "a new visit has nothing to undo");
    engine.clearSpray("car");
    engine.setSprayTool({ on: false });
  });
});
