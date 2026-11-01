import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as THREE from "three";
import "../kernel/rapier-node.test-util.ts";
import { FRAME_HZ } from "../kernel/constants.ts";
import { ROLE } from "../present/dummy-rig.ts";
import { SHOWCASE_EYE, SHOWCASE_GALLERY, SHOWCASE_THROWN, THROWN_KINDS, THROWN_PER_KIND } from "../present/showcase-art.ts";
import { PREFABS } from "../world/catalog.ts";
import { PREFAB } from "../world/constants.ts";
import { setGround } from "../world/ground.ts";
import type { CrashEngine } from "./engine.ts";
import { bootEngine, pressKey, runSeconds, stubBrowser } from "./engine-headless.test-util.ts";

/**
 * The showcase's number keys beyond the first four (`#scene=showcase`): the muscle car's bumper, the monster truck's wheel and a car's wheel
 * fly through the dummies' world and strike a figure by the one law; 8 and 9 throw a man and a woman who get up and wander; the set's cars
 * and gallery stop what is thrown at them; 0 puts it all away; the number pad is the row's twin.
 */

const FRAME = 1 / FRAME_HZ;
const CHEST_Y = 1.2;
/** The owner's bound (m): a thrown dummy wanders within this far of the showcase's middle. */
const WITHIN = 30;
type Away = { figure: number; slot: number; seconds: number; wander: unknown };

let engine: CrashEngine;
const art = () => engine["showcase"]!.art;
const ragdolls = () => engine["ragdolls"];
const away = (): Away[] => engine["showcase"]!["walks"]["away"];
const thrownDummies = (): Away[] => away().filter((a) => a.figure < 0);
const firstOf = (prefab: string): number => THROWN_KINDS.indexOf(prefab as (typeof THROWN_KINDS)[number]) * THROWN_PER_KIND;

/** The camera at `eye` looking at `target`, in the stand-in canvas's 800 x 600 shape. */
function lookFrom(eye: readonly number[], target: readonly number[]): void {
  const camera = engine["camera"];
  camera.clearViewOffset();
  camera.aspect = 800 / 600;
  camera.updateProjectionMatrix();
  camera.position.set(eye[0]!, eye[1]!, eye[2]!);
  camera.lookAt(target[0]!, target[1]!, target[2]!);
  camera.updateMatrixWorld(true);
}

const lookAtSet = (): void => lookFrom([SHOWCASE_EYE.x, SHOWCASE_EYE.y, SHOWCASE_EYE.z], [SHOWCASE_EYE.lookX, SHOWCASE_EYE.lookY, SHOWCASE_EYE.lookZ]);

function screenOf(at: THREE.Vector3): [number, number] {
  const p = at.clone().project(engine["camera"]);
  return [((p.x + 1) / 2) * 800, ((1 - p.y) / 2) * 600];
}

/** The cursor over world point `at`, then the key `code`. */
function throwAt(at: THREE.Vector3, code: string): void {
  [engine["view"].hoverX, engine["view"].hoverY] = screenOf(at);
  pressKey(engine, code);
}

/** A clean showcase: everyone on his mark, nothing thrown, the eye on the set. */
function settle(): void {
  engine.reset();
  lookAtSet();
  runSeconds(engine, 2 * FRAME);
}

/** The thrown props of `prefab` out in the world now, by index. */
function outOf(prefab: string): number[] {
  const p = new THREE.Vector3();
  const v = new THREE.Vector3();
  const first = firstOf(prefab);
  return Array.from({ length: THROWN_PER_KIND }, (_, k) => first + k).filter((i) => ragdolls().propAt(i, p, v));
}

/** Prop `i`'s middle and speed (m/s) now. */
function propNow(i: number): { at: THREE.Vector3; speed: number } {
  const at = new THREE.Vector3();
  const v = new THREE.Vector3();
  expect(ragdolls().propAt(i, at, v), `prop ${i} is out`).toBe(true);
  return { at, speed: v.length() };
}

const chestOf = (slot: number): THREE.Vector3 => art().markOf(slot, new THREE.Vector3()).setY(CHEST_Y);

/** Whether figure 0 was knocked down within a second of key `code` thrown at his chest, and whether he stepped into the ragdoll world to meet it. */
function struckBy(code: string): { down: boolean; met: boolean } {
  settle();
  throwAt(chestOf(0), code);
  return watchFigure();
}

function watchFigure(): { down: boolean; met: boolean } {
  let down = false;
  let met = false;
  for (let f = 0; f < FRAME_HZ; f++) {
    runSeconds(engine, FRAME);
    const him = away().find((a) => a.figure === 0);
    if (him === undefined) continue;
    met = true;
    down ||= ragdolls().walkers[him.slot]!.state === "down";
  }
  return { down, met };
}

beforeAll(async () => {
  stubBrowser();
  globalThis.location.hash = "#scene=showcase";
  engine = await bootEngine();
  await ragdolls().preload();
  runSeconds(engine, 0.5);
});
afterAll(() => {
  engine.dispose();
  setGround(null);
});

describe("given a car part thrown at a standing figure's chest", () => {
  const parts = [
    { name: "muscle car's bumper (27 kg at 15 m/s)", code: "Digit5" },
    { name: "monster truck's wheel (184 kg)", code: "Digit6" },
    { name: "car's wheel (20 kg)", code: "Digit7" },
  ] as const;
  for (const part of parts) {
    it(`when the ${part.name} is thrown, then he goes down: the one law (knocksDown), at the part's own mass`, () => {
      expect(struckBy(part.code)).toEqual({ down: true, met: true });
    });
  }

  it("when the same bumper is lobbed at him at 3 m/s (0.6 m/s into his 101 kg, under the 1 m/s that knocks a man down), then it bounces off him and he stays on his feet", () => {
    settle();
    const at = chestOf(0).add(new THREE.Vector3(0, 0.1, 1.5));
    expect(ragdolls().throwProp(firstOf(PREFAB.muscleBumper), at, new THREE.Vector3(0, 0.8, -3)), "it flew").toBe(true);
    expect(watchFigure()).toEqual({ down: false, met: true });
  });
});

describe("given a crate thrown at what the set holds", () => {
  /** The crate's middle each frame for `seconds` after a throw at `at` from the eye `from` looking at `aimed`, and its speed (m/s) at the end. */
  function crateFlight(from: readonly number[], aimed: readonly number[], at: THREE.Vector3, seconds: number): { path: THREE.Vector3[]; speed: number } {
    settle();
    lookFrom(from, aimed);
    throwAt(at, "Digit2");
    const path: THREE.Vector3[] = [];
    for (let f = 0; f < seconds * FRAME_HZ; f++) {
      runSeconds(engine, FRAME);
      path.push(propNow(firstOf(PREFAB.crate)).at);
    }
    return { path, speed: propNow(firstOf(PREFAB.crate)).speed };
  }

  it("when a crate is thrown level at a parked car's flank, then it stops against it: its middle is never inside the car's plan box under the roof, and it comes to rest", () => {
    settle();
    const car = engine["showcase"]!.cars[1]!;
    const across = new THREE.Vector3(Math.cos(car.group.rotation.y), 0, -Math.sin(car.group.rotation.y));
    const from = car.group.position.clone().addScaledVector(across, 6).setY(1.6);
    expect(ragdolls().throwProp(firstOf(PREFAB.crate), from, across.clone().multiplyScalar(-15)), "it flew").toBe(true);
    const path: THREE.Vector3[] = [];
    for (let f = 0; f < 4 * FRAME_HZ; f++) {
      runSeconds(engine, FRAME);
      path.push(propNow(firstOf(PREFAB.crate)).at);
    }
    const [left, right, back, front] = car.cage.fields.planBox;
    const inside = path.filter((p) => {
      const local = car.group.worldToLocal(p.clone());
      return local.x > left! && local.x < right! && local.z > back! && local.z < front! && p.y < car.style.dims.height;
    });
    const speed = propNow(firstOf(PREFAB.crate)).speed;
    expect({ frames: inside.length, still: speed < 0.5 }, `inside at ${inside[0]?.toArray().map((v) => v.toFixed(2))}, ended at ${path.at(-1)!.toArray().map((v) => v.toFixed(2))}`).toEqual({ frames: 0, still: true });
  });

  it("when a crate is thrown at the gallery's rock, then it stops at the rock's near face: its middle never passes it", () => {
    const rock = SHOWCASE_GALLERY.find((p) => p.prefab === PREFAB.rock)!;
    const face = new THREE.Vector3(rock.x, 0.8, rock.z - PREFABS[PREFAB.rock].size[2] / 2);
    const { path, speed } = crateFlight([0, 1.5, 8], [rock.x, 0.8, rock.z], face, 3);
    const farthest = Math.max(...path.map((p) => p.z));
    expect({ past: farthest > rock.z, still: speed < 0.5 }, `its middle got to z ${farthest.toFixed(2)}, the rock's middle is at ${rock.z}`).toEqual({ past: false, still: true });
  });
});

describe("given the showcase's keys 8 and 9", () => {

  /** Key `code` over the floor at `landing`, the eye turned to it; the seconds (s) he is watched; what he went through and how far from the middle he got. */
  function watched(code: string, landing: THREE.Vector3, seconds: number): { states: string[]; farthest: number; marked: number; walked: number; shirt: string } {
    settle();
    // Each mark is two draws: the radius (near the edge of the circle), then the angle (due +x, the clear way along the floor).
    let draws = 0;
    engine["showcase"]!["walks"]["random"] = () => (draws++ % 2 === 0 ? 0.999 : 0.25);
    lookFrom([SHOWCASE_EYE.x, SHOWCASE_EYE.y, SHOWCASE_EYE.z], landing.toArray());
    throwAt(landing, code);
    const him = thrownDummies()[0]!;
    const walker = ragdolls().walkers[him.slot]!;
    const shirt = ragdolls()["mesh"].colourOf(him.slot, ROLE.SHIRT, new THREE.Color()).getHexString();
    const states = new Set<string>();
    const at = new THREE.Vector3();
    const mark = him.wander as { x: number; z: number };
    let farthest = 0;
    let marked = 0;
    let walked = 0;
    let last: THREE.Vector3 | null = null;
    for (let t = 0; t < seconds; t += 0.1) {
      runSeconds(engine, 0.1);
      states.add(walker.state);
      if (!ragdolls().walkerTorso(at, him.slot)) break;
      farthest = Math.max(farthest, Math.hypot(at.x, at.z));
      if (Number.isFinite(mark.x)) marked = Math.max(marked, Math.hypot(mark.x, mark.z));
      if (walker.state === "stand" && last) walked += Math.hypot(at.x - last.x, at.z - last.z);
      last = at.clone();
    }
    return { states: [...states].sort(), farthest, marked, walked, shirt };
  }

  it("when 8 is pressed, then a man is thrown: he lands, gets up, walks to a mark at the edge of the circle and on, and never leaves 30 m of the middle", () => {
    const run = watched("Digit8", new THREE.Vector3(14, 0, 6), 20);
    expect(run.states, "he lay, got up and stood").toEqual(["down", "getUp", "stand"]);
    expect(run.shirt, "in the man's blue tee").toBe(new THREE.Color(art().figureOf(0).look.shirt).getHexString());
    expect(run.walked, `walked ${run.walked.toFixed(1)} m standing`).toBeGreaterThan(5);
    expect(run.marked, `his marks lay out to ${run.marked.toFixed(1)} m`).toBeGreaterThan(WITHIN - 5);
    expect(run.marked, `his marks lay out to ${run.marked.toFixed(1)} m`).toBeLessThanOrEqual(WITHIN);
    expect(run.farthest, `got ${run.farthest.toFixed(1)} m from the middle`).toBeLessThanOrEqual(WITHIN);
  });

  it("when 9 is pressed, then a woman is thrown and gets up in her own dress", () => {
    const run = watched("Digit9", new THREE.Vector3(0, 0, 4), 10);
    expect(run.states).toContain("getUp");
    expect(run.shirt).toBe(new THREE.Color(art().figureOf(1).look.shirt).getHexString());
  });
});

describe("given a thrown dummy whose mark lies behind a parked car", () => {
  /** His clock (s since he picked his mark) set half a second short of the give-up (30 s): the wait itself is not run. */
  const NEARLY_GIVEN_UP_S = 29.5;
  /** His torso's distance (m) from the car's middle once he is against its flank (0.9 m measured: the plan box is 0.78 m to a side). */
  const AT_THE_FLANK_M = 1.5;

  it("when he walks into the car's flank and cannot get past, then he keeps his mark until the give-up, takes another then, and keeps that one", () => {
    settle();
    // Every pick lies out at 28 m, on alternate sides (angle 0.25, then 0.75: x = +28, then -28): a pick that is repeated every frame moves the mark, so "keeps the new one" can fail.
    let draws = 0;
    engine["showcase"]!["walks"]["random"] = () => (draws++ % 2 === 0 ? 0.999 : draws % 4 === 2 ? 0.25 : 0.75);
    const car = engine["showcase"]!.cars[1]!;
    const across = new THREE.Vector3(Math.cos(car.group.rotation.y), 0, -Math.sin(car.group.rotation.y));
    const near = car.group.position.clone().addScaledVector(across, 6);
    const behind = car.group.position.clone().addScaledVector(across, -6);
    expect(Math.hypot(behind.x, behind.z), "the blocked mark is inside the wander circle").toBeLessThan(WITHIN - 2);
    expect(engine["showcase"]!["walks"].throwFigure(0, new THREE.Vector3(near.x, 1.5, near.z), new THREE.Vector3()), "he is thrown").toBeGreaterThanOrEqual(0);
    const him = thrownDummies()[0]!;
    const walker = ragdolls().walkers[him.slot]!;
    for (let t = 0; t < 10 && walker.state !== "stand"; t += 0.1) runSeconds(engine, 0.1);
    expect(walker.state, "he got up").toBe("stand");
    const mark = him.wander as { x: number; z: number };
    mark.x = behind.x;
    mark.z = behind.z;
    him.seconds = 0;
    const keepsHisMark = (): boolean => Math.hypot(mark.x - behind.x, mark.z - behind.z) < 1;
    const torso = new THREE.Vector3();
    const toCar = (): number => (ragdolls().walkerTorso(torso, him.slot) ? Math.hypot(torso.x - car.group.position.x, torso.z - car.group.position.z) : Infinity);
    // He may fall again as he sets out; the walk to the car's flank takes 4 s once he is up.
    for (let t = 0; t < 20 && toCar() > AT_THE_FLANK_M; t += 0.5) runSeconds(engine, 0.5);
    expect(toCar(), "he walked up to the car's flank").toBeLessThan(AT_THE_FLANK_M);
    runSeconds(engine, 2);
    expect(toCar(), "and is held there, not past it").toBeLessThan(AT_THE_FLANK_M);
    expect(keepsHisMark(), "held there, he has not arrived and keeps his mark").toBe(true);
    him.seconds = NEARLY_GIVEN_UP_S;
    runSeconds(engine, 0.3);
    expect(keepsHisMark(), "short of the give-up he keeps it").toBe(true);
    runSeconds(engine, 0.6);
    expect(keepsHisMark(), "past the give-up he has taken another").toBe(false);
    const taken = { x: mark.x, z: mark.z };
    runSeconds(engine, 2);
    expect(Math.hypot(mark.x - taken.x, mark.z - taken.z), "he kept the new one for the next 2 s").toBe(0);
    expect(him.seconds, "counting from the new mark").toBeLessThan(5);
  });
});

describe("given things thrown and then 0", () => {
  it("when 0 is pressed, then every prop is back under the floor, every thrown dummy is gone, and the next throw of a kind is its first again", () => {
    settle();
    for (const code of ["Digit1", "Digit5", "Digit6", "Digit8", "Digit9"]) {
      throwAt(new THREE.Vector3(0, 0, 4), code);
      runSeconds(engine, 0.1);
    }
    const slots = thrownDummies().map((a) => a.slot);
    expect(slots.length, "two dummies thrown").toBe(2);
    expect(outOf(PREFAB.cone).length + outOf(PREFAB.muscleBumper).length + outOf(PREFAB.monsterWheel).length, "three props out").toBe(3);
    pressKey(engine, "Digit0");
    runSeconds(engine, FRAME);
    for (const prefab of new Set(SHOWCASE_THROWN.map((p) => p.prefab))) expect(outOf(prefab), `${prefab} out`).toEqual([]);
    expect(thrownDummies(), "thrown dummies listed").toEqual([]);
    expect(slots.map((s) => ragdolls()["dolls"][s].live), "their dummies in the world").toEqual([false, false]);
    throwAt(new THREE.Vector3(0, 0, 4), "Digit5");
    expect(outOf(PREFAB.muscleBumper).join(), "the bumper thrown is the kind's first").toBe(String(firstOf(PREFAB.muscleBumper)));
  });
});

describe("given the number pad", () => {
  it("when Numpad5 is pressed, then it throws what Digit5 throws, the same way", () => {
    const run = (code: string): number[] => {
      settle();
      throwAt(new THREE.Vector3(0, 0, 4), code);
      runSeconds(engine, 0.5);
      return outOf(PREFAB.muscleBumper).flatMap((i) => propNow(i).at.toArray());
    };
    const row = run("Digit5");
    expect(row.length, "a bumper is out").toBe(3);
    expect(run("Numpad5").join()).toBe(row.join());
  });

  it("when Numpad0 is pressed, then everything thrown is put away", () => {
    settle();
    throwAt(new THREE.Vector3(0, 0, 4), "Numpad2");
    expect(outOf(PREFAB.crate).length).toBe(1);
    pressKey(engine, "Numpad0");
    runSeconds(engine, FRAME);
    expect(outOf(PREFAB.crate)).toEqual([]);
  });
});

describe("given a kind thrown more than it has bodies", () => {
  it(`when a crate is thrown ${THROWN_PER_KIND} times, then all of them are out at once, and the next throw takes the oldest again`, () => {
    settle();
    for (let n = 0; n < THROWN_PER_KIND; n++) {
      throwAt(new THREE.Vector3(-6 + (n % 8) * 1.5, 0, 3 + Math.floor(n / 8)), "Digit2");
      runSeconds(engine, FRAME);
    }
    expect(outOf(PREFAB.crate).length, "every crate out").toBe(THROWN_PER_KIND);
    const oldest = firstOf(PREFAB.crate);
    const before = propNow(oldest).at.clone();
    throwAt(new THREE.Vector3(0, 0, 4), "Digit2");
    const after = propNow(oldest).at;
    expect(outOf(PREFAB.crate).length, "still as many").toBe(THROWN_PER_KIND);
    expect(after.distanceTo(before), `the oldest was taken again: it moved ${after.distanceTo(before).toFixed(1)} m`).toBeGreaterThan(1);
  });
});
