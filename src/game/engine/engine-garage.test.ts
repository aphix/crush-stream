import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as THREE from "three";
import "../kernel/rapier-node.test-util.ts";
import { HudStore } from "../hud/hud-store.ts";
import { carPickText, NO_CAR_PICK, NO_PERSON_PICK, personPickText, SPRAY_FACE, SPRAY_PALETTE, type SprayLayout } from "../match/look-data.ts";
import { decodeShare } from "../hud/share-url.ts";
import { FRAME_HZ } from "../kernel/constants.ts";
import { ORBIT_RADIUS } from "../present/engine-camera.ts";
import { GARAGE } from "../present/garage-art.ts";
import { PARTS } from "../present/ragdoll-body.ts";
import type { SprayBitmap } from "../present/spray.ts";
import { setGround } from "../world/ground.ts";
import { assertSameNumbers } from "../vehicle/test-support.ts";
import { PlayerLooks, type SprayTarget } from "./player-looks.ts";
import type { CrashEngine } from "./engine.ts";
import { runSeconds, bootEngine, element, stubBrowser } from "./engine-headless.test-util.ts";

const FRAME = 1 / FRAME_HZ;
/** The scenes the garage is entered from: the fleet's car driven (its chase cam on), a mini game's followed, a race's field of eight. */
const ENTRIES = ["fleet", "driving", "minigame", "race"] as const;
/** How far (m) an eye may move and still be "put": float noise, nothing a person sees. */
const STILL = 1e-6;

/**
 * Texel `i`'s mirror across the body's left-right plane in `layout` (`sprayFace`'s box): the same place on the other flank,
 * or flipped across the face for the top (its v runs along x) and the ends (their u does); -1 off every face.
 */
function mirrorTexel(layout: SprayLayout, i: number): number {
  const x = i % layout.w;
  const y = Math.floor(i / layout.w);
  const face = layout.faces.findIndex(([fx, fy, fw, fh]) => x >= fx && x < fx + fw && y >= fy && y < fy + fh);
  if (face < 0) return -1;
  const [fx, fy, fw, fh] = layout.faces[face]!;
  if (face === SPRAY_FACE.left || face === SPRAY_FACE.right) {
    const [ox, oy] = layout.faces[face === SPRAY_FACE.left ? SPRAY_FACE.right : SPRAY_FACE.left]!;
    return (oy + y - fy) * layout.w + ox + x - fx;
  }
  if (face === SPRAY_FACE.top) return (2 * fy + fh - 1 - y) * layout.w + x;
  return y * layout.w + 2 * fx + fw - 1 - x;
}

/** The painted texels of `bitmap` whose mirror (`mirrorTexel`) holds another ink: 0 for a left-right symmetric bitmap. */
function asymmetry(bitmap: SprayBitmap): number {
  let n = 0;
  for (let i = 0; i < bitmap.texels.length; i++) if (bitmap.texels[i] !== 0 && bitmap.texels[mirrorTexel(bitmap.layout, i)] !== bitmap.texels[i]) n++;
  return n;
}

describe("given the real engine in the garage", () => {
  // One engine for the file: a second `CrashEngine` in the same process never resolves `ready`.
  let engine: CrashEngine;
  let hud: HudStore;
  // The engine's canvas takes real pointer and wheel events: the camera's own handlers zoom.
  const canvas = element();
  const events = new EventTarget();
  Object.assign(canvas, { addEventListener: events.addEventListener.bind(events), removeEventListener: events.removeEventListener.bind(events), dispatchEvent: events.dispatchEvent.bind(events), setPointerCapture() {} });
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
      runSeconds(engine, 1);
    }
    runSeconds(engine, FRAME);
    engine.fadeScenes = true;
    engine["setScene"]("garage");
    // The fade holds black while the garage's programs warm: their promises settle between frames.
    for (let i = 0; i < 10 * FRAME_HZ && (engine["sceneId"] !== "garage" || engine["sceneFade"].pending !== null); i++) {
      runSeconds(engine, FRAME);
      await engine.warmsIdle();
    }
    engine.fadeScenes = false;
    runSeconds(engine, FRAME);
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
    runSeconds(engine, 1);
    const [first, ...rest] = over.map(pointOver);
    const garage = engine["garage"]!;
    const sprayed = garage.down(first!.x, first!.y);
    for (const at of rest) garage.move({ clientX: at.x, clientY: at.y });
    garage.up();
    return { sprayed, car: engine["looks"].sprayOf("car").painted(), person: engine["looks"].sprayOf("person").painted() };
  };
  /** The orbit's bearing from the car's far side (-x): the car stands between the eye and the driver. */
  const FAR_SIDE = -Math.PI / 2;

  beforeAll(async () => {
    stubBrowser();
    hud = new HudStore();
    engine = await bootEngine({ hud, canvas });
  });
  afterAll(() => {
    engine.dispose();
    setGround(null);
  });

  it("when it is entered from the fleet (driving or not), a mini game or a race, then it opens on its shot and the eye stays put idle, and a tap on the car, W and View leave the seat on the whole set and the eye and the car where they were", async () => {
    for (const from of ENTRIES) {
      await enter(from);
      expect(engine["sceneId"], from).toBe("garage");
      const opening = eye();
      const { lookX, lookY, lookZ, radius: r, pitch } = GARAGE.shot;
      const shot = new THREE.Vector3(lookX + Math.sin(GARAGE.angle) * r * Math.cos(pitch), lookY + r * Math.sin(pitch), lookZ + Math.cos(GARAGE.angle) * r * Math.cos(pitch));
      expect(opening.distanceTo(shot), `${from}: the eye opens ${opening.distanceTo(shot).toFixed(3)} m off the garage's shot`).toBeLessThan(STILL);
      expect(look().distanceTo(new THREE.Vector3(lookX, lookY, lookZ)), `${from}: the orbit circles ${look().toArray().map((v) => v.toFixed(2)).join(", ")}, not the garage's shot`).toBeLessThan(STILL);
      runSeconds(engine, 5);
      expect(eye().distanceTo(opening), `${from}: the idle eye moved ${eye().distanceTo(opening).toFixed(3)} m in 5 s`).toBeLessThan(STILL);
      engine.watchCar(0);
      engine["keys"].add("KeyW");
      runSeconds(engine, 0.5);
      engine["keys"].clear();
      engine.cycleCamera();
      runSeconds(engine, 0.5);
      expect(engine["seat"].mode, `${from}: the seat`).toBe("global");
      expect(engine["view"].flying, `${from}: View flew the eye free`).toBe(false);
      expect(hud.get().cam, `${from}: the HUD names a camera`).toBe(null);
      expect(eye().distanceTo(opening), `${from}: the tap, W and View moved the eye ${eye().distanceTo(opening).toFixed(3)} m`).toBeLessThan(STILL);
      expect(engine["carA"].group.position.length(), `${from}: the car drove to ${engine["carA"].group.position.toArray().map((v) => v.toFixed(2)).join(", ")}`).toBeLessThan(0.01);
    }
  });

  it("when the driver is picked, then the orbit circles his torso as he is posed and keeps it there, and the car's pick puts it back on the car's shot", async () => {
    await enter("fleet");
    engine.frameGarage("person");
    runSeconds(engine, 1);
    // His torso's bone as drawn (translation, rotation: `DummyMesh.pose`), and the orbit's centre in its frame.
    const rows: Float32Array = engine["garage"]!.art.dummy["rows"];
    const turn = new THREE.Quaternion().fromArray(rows, 4);
    const local = look().sub(new THREE.Vector3().fromArray(rows, 0)).applyQuaternion(turn.invert()).sub(new THREE.Vector3(...PARTS[0].c));
    const [hx, hy, hz] = PARTS[0].h;
    expect(Math.abs(local.x) <= hx && Math.abs(local.y) <= hy && Math.abs(local.z) <= hz, `the centre sits ${local.toArray().map((v) => v.toFixed(2)).join(", ")} m off his torso's middle, outside its box`).toBeTruthy();
    const centre = look();
    runSeconds(engine, 5);
    expect(look().distanceTo(centre), "the centre went back to the car").toBeLessThan(STILL);
    engine.frameGarage("car");
    runSeconds(engine, FRAME);
    expect(look().distanceTo(new THREE.Vector3(GARAGE.shot.lookX, GARAGE.shot.lookY, GARAGE.shot.lookZ)), "the car's pick centres on the car's shot").toBeLessThan(STILL);
  });

  it("when the wheel or a pinch zooms in, then the orbit comes in to its shot's closest, the car's or the driver's, and in a race or the fleet no closer than before", async () => {
    await enter("fleet");
    wheelIn();
    expect(radius(), "the wheel on the car's shot").toBe(GARAGE.shot.minRadius);
    engine.frameGarage("person");
    pinchOut();
    expect(radius(), "a pinch on the driver's shot").toBe(GARAGE.driverShot.minRadius);
    engine["setScene"]("race");
    runSeconds(engine, FRAME);
    wheelIn();
    expect(radius(), "a race's wheel, straight from the driver's shot").toBe(ORBIT_RADIUS.min);
    engine["setScene"]("fleet");
    runSeconds(engine, FRAME);
    wheelIn();
    expect(radius(), "the fleet's wheel").toBe(ORBIT_RADIUS.min);
  });

  it("when the fleet's cars are left for the garage, then the garage holds the player's car alone, and the fleet gets all of them back", async () => {
    await enter("fleet");
    const fleet = engine["sandboxCars"];
    expect(fleet, `the fleet has ${fleet} cars`).toBeGreaterThan(1);
    expect(engine["cars"].length, "cars in the garage").toBe(1);
    engine["setScene"]("fleet");
    runSeconds(engine, FRAME);
    expect(engine["cars"].length, "cars back in the fleet").toBe(fleet);
    expect(engine["live"]().length, "and all of them shown").toBe(fleet);
  });

  it("when it is entered, then no driver sits in the car (the standing dummy is the driver), and back in the fleet the drivers sit in their cars again", async () => {
    const scene = engine["scene"];
    /** The seated drivers drawn after the render pass's sync (the stand-in renderer never fires it). */
    const seated = (): number => {
      scene.updateMatrixWorld(true);
      scene.onBeforeRender(engine["renderer"], scene, engine["camera"], new THREE.BufferGeometry(), new THREE.MeshBasicMaterial(), new THREE.Group());
      return engine["seated"].mesh.count;
    };
    engine["setScene"]("fleet");
    runSeconds(engine, FRAME);
    expect(seated(), "control: the fleet's drivers sit in their cars").toBeGreaterThan(0);
    await enter("fleet");
    expect(seated(), "a driver sits in the garage's car").toBe(0);
    expect(engine["garage"]!.art.dummy.visible, "the standing dummy is shown").toBeTruthy();
    engine["setScene"]("fleet");
    runSeconds(engine, FRAME);
    expect(seated(), "the drivers sit again in the fleet").toBeGreaterThan(0);
  });

  it("when the can is on, then a stroke paints only what the panel edits: the other one drops out of the ray, so it never blocks or takes paint", async () => {
    await enter("fleet");
    engine.setSprayTool({ on: true });
    const rows = [
      { got: stroke("person", ["carOnly", "carOnly"]), sprayed: false, car: false, person: false, why: "Driver picked, a stroke over the car" },
      { got: stroke("person", ["driverBehind", "driverBehind"], FAR_SIDE), sprayed: true, car: false, person: true, why: "Driver picked, a stroke over him behind the car" },
      { got: stroke("car", ["driverFront", "carOnly"]), sprayed: true, car: true, person: false, why: "Car picked, a stroke from him in front of the car across the car" },
      { got: stroke("car", ["driverOnly", "driverOnly"]), sprayed: false, car: false, person: false, why: "Car picked, a stroke over him alone" },
    ];
    for (const row of rows) {
      expect(row.got.sprayed, `${row.why}: sprayed`).toBe(row.sprayed);
      expect(row.got.car, `${row.why}: car took paint`).toBe(row.car);
      expect(row.got.person, `${row.why}: person took paint`).toBe(row.person);
    }
    engine.setSprayTool({ on: false });
  });

  it("when two strokes are sprayed on the car and one undone, then the bitmap and its save are the first stroke's exactly; redo puts the second back, a new stroke leaves nothing to redo, a clear is one step, and leaving the garage drops them", async () => {
    const saved = new Map<string, string>();
    Object.assign(globalThis, { localStorage: { getItem: (k: string) => saved.get(k) ?? null, setItem: (k: string, v: string) => saved.set(k, v), removeItem: (k: string) => saved.delete(k) } });
    await enter("fleet");
    engine.setSprayTool({ on: true });
    engine.frameGarage("car");
    runSeconds(engine, 1);
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
    expect(Buffer.compare(first, second), "the second stroke changed the bitmap").not.toBe(0);
    engine.undoSpray();
    assertSameNumbers(bitmap.rgba, first, "undone: the bitmap after the first stroke");
    assertSameNumbers(reloaded(), first, "undone: what storage keeps");
    expect(hud.get().garage?.redo, "one stroke to redo").toBe(1);
    engine.redoSpray();
    assertSameNumbers(bitmap.rgba, second, "redone: the bitmap after the second stroke");
    assertSameNumbers(reloaded(), second, "redone: what storage keeps");
    engine.undoSpray();
    const third = spray(SPRAY_PALETTE[10]!);
    engine.redoSpray();
    assertSameNumbers(bitmap.rgba, third, "a new stroke dropped the redo chain");
    engine.clearSpray("car");
    expect(bitmap.painted(), "cleared").toBe(false);
    engine.undoSpray();
    assertSameNumbers(bitmap.rgba, third, "the clear undone");
    await enter("fleet");
    engine.undoSpray();
    assertSameNumbers(bitmap.rgba, third, "a new visit has nothing to undo");
    engine.clearSpray("car");
    engine.setSprayTool({ on: false });
  });

  it("when Symmetric is on, then a stroke on the car or the driver is painted mirrored across the body's left-right plane too, texel for texel on the other flank or across the same face and nowhere else, as one step to undo; with it off the same stroke is not", async () => {
    await enter("fleet");
    const random = Math.random;
    // Every texel inside a puff takes paint (`SprayBitmap.spray` speckles a puff's rim off this stream), so the halves compare exactly.
    Math.random = () => 0;
    try {
      for (const [edit, over] of [["car", "carOnly"], ["person", "driverOnly"]] as const) {
        for (const mirror of [false, true]) {
          engine.setSprayTool({ on: true, mirror });
          engine.clearSpray(edit);
          engine.frameGarage(edit);
          runSeconds(engine, 1);
          const at = pointOver(over);
          const garage = engine["garage"]!;
          garage.down(at.x, at.y);
          garage.move({ clientX: at.x + 15, clientY: at.y + 5 });
          garage.up();
          const bitmap = engine["looks"].sprayOf(edit);
          expect(bitmap.painted(), `${edit}: the stroke painted`).toBeTruthy();
          const off = asymmetry(bitmap);
          if (!mirror) {
            expect(off, `${edit}: the stroke alone is already symmetric, so the row proves nothing`).toBeGreaterThan(0);
            continue;
          }
          expect(off, `${edit}: ${off} painted texels without their mirror`).toBe(0);
          engine.undoSpray();
          expect(bitmap.painted(), `${edit}: one undo took both halves`).toBe(false);
        }
      }
    } finally {
      Math.random = random;
      engine.setSprayTool({ on: false, mirror: false });
    }
  });

  it("when the driver and the car are picked in the garage and the page loads with a link that names no picks, then the picks stay; a link that names the driver's picks overrides them for that visit and leaves the car's", async () => {
    const saved = new Map<string, string>();
    Object.assign(globalThis, { localStorage: { getItem: (k: string) => saved.get(k) ?? null, setItem: (k: string, v: string) => saved.set(k, v), removeItem: (k: string) => saved.delete(k) } });
    const chosen = { woman: true, shirt: 0x123456, pants: 0x654321, hair: null, hat: 0xabcdef, mustache: true };
    engine.setPersonPick(chosen);
    engine.setCarColour("body", 0xff0000);
    const look = (): string => `${personPickText(engine["looks"].mine.person)} ${carPickText(engine["looks"].mine.car)}`;
    const chosenLook = look();
    engine["applyShare"](decodeShare(""), false);
    expect(look(), "a bare link").toBe(chosenLook);
    const reloaded = new PlayerLooks();
    expect(personPickText(reloaded.mine.person), "what the next visit starts with").toBe(personPickText({ ...NO_PERSON_PICK, ...chosen }));
    reloaded.dispose();
    engine["applyShare"](decodeShare(`pk=${personPickText({ ...NO_PERSON_PICK, woman: false })}`), false);
    expect(look(), "a link naming the driver").toBe(`${personPickText({ ...NO_PERSON_PICK, woman: false })} ${carPickText(engine["looks"].mine.car)}`);
    expect(look().endsWith(carPickText({ ...NO_CAR_PICK, body: 0xff0000 })), "the car's pick kept").toBeTruthy();
    engine.setPersonPick(NO_PERSON_PICK);
    engine.setCarColour("body", null);
  });
});
