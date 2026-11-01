import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as THREE from "three";
import "../kernel/rapier-node.test-util.ts";
import { SHOWCASE_EYE } from "../present/showcase-art.ts";
import { SLOTS } from "../present/ragdoll-config.ts";
import { setGround } from "../world/ground.ts";
import type { CrashEngine } from "./engine.ts";
import { bootEngine, pressKey, stubBrowser } from "./engine-headless.test-util.ts";

/**
 * The showcase on a slow device: frames of 50 ms, longer than the walkers' foot locks' ramp. Dummies out there were pulled to the world's
 * origin and flung (the owner's "ragdolls fly like crazy and are sucked into the middle of the map").
 */
const FRAME = 1 / 20;
/** Throws enough to build every slot and send the oldest dummies home for the later ones. */
const THROWS = SLOTS + 8;
/** The wander circle's radius (m) and what a dummy landing in it may be past it (a lob's own overshoot). */
const CIRCLE_M = 30;
const LANDED_M = 4;
/** A standing walker's parts swing at up to 6 m/s; his torso goes his walking pace (1.6 m/s). Flung dummies reached 40 to 130 m/s. */
const SETTLED_MPS = 6;
const TORSO_MPS = 3;
/** Seconds after the last throw for the last dummy to have landed, lain and got up (measured: 7). */
const LANDED_S = 8;
const CHEST_Y = 1.2;

type Out = { slot: number; x: number; y: number; z: number; speed: number; torsoSpeed: number };

let engine: CrashEngine;
const art = () => engine["showcase"]!.art;
const ragdolls = () => engine["ragdolls"];
const away = (): { figure: number; slot: number }[] => engine["showcase"]!["walks"]["away"];

function run(seconds: number, each?: () => void): void {
  for (let f = 0; f < seconds / FRAME; f++) {
    engine.advance(FRAME, { frameDt: FRAME });
    each?.();
  }
}

function lookAtSet(): void {
  const camera = engine["camera"];
  camera.clearViewOffset();
  camera.aspect = 800 / 600;
  camera.updateProjectionMatrix();
  camera.position.set(SHOWCASE_EYE.x, SHOWCASE_EYE.y, SHOWCASE_EYE.z);
  camera.lookAt(SHOWCASE_EYE.lookX, SHOWCASE_EYE.lookY, SHOWCASE_EYE.lookZ);
  camera.updateMatrixWorld(true);
}

function throwAt(at: THREE.Vector3, code: string): void {
  const p = at.clone().project(engine["camera"]);
  [engine["view"].hoverX, engine["view"].hoverY] = [((p.x + 1) / 2) * 800, ((1 - p.y) / 2) * 600];
  pressKey(engine, code);
}

function settle(): void {
  engine.reset();
  lookAtSet();
  run(2 * FRAME);
}

/** Every dummy out now: his slot, torso (m), the fastest of his parts and his torso's speed (m/s). */
function dummiesOut(): Out[] {
  const out: Out[] = [];
  for (const [slot, d] of ragdolls()["dolls"].entries()) {
    if (!d.live) continue;
    const torso = d.bodies[0]!.translation();
    const v = d.bodies[0]!.linvel();
    let speed = 0;
    for (const body of d.bodies) speed = Math.max(speed, Math.hypot(body.linvel().x, body.linvel().y, body.linvel().z));
    out.push({ slot, x: torso.x, y: torso.y, z: torso.z, speed, torsoSpeed: Math.hypot(v.x, v.y, v.z) });
  }
  return out;
}

const fastest = (): number => Math.max(0, ...dummiesOut().map((d) => d.speed));

beforeAll(async () => {
  stubBrowser();
  globalThis.location.hash = "#scene=showcase";
  engine = await bootEngine();
  await ragdolls().preload();
  run(0.5);
});
afterAll(() => {
  engine.dispose();
  setGround(null);
});

describe("given the showcase at 20 fps", () => {
  it("when a cone is thrown at a standing figure, then the figures it brings into the ragdoll world stay on their marks and none moves fast", () => {
    settle();
    throwAt(art().markOf(3, new THREE.Vector3()).setY(CHEST_Y), "Digit1");
    let peak = 0;
    let stoodIn = 0;
    let strayed = 0;
    const mark = new THREE.Vector3();
    run(4, () => {
      peak = Math.max(peak, fastest());
      stoodIn = Math.max(stoodIn, away().length);
      for (const a of away()) {
        const him = dummiesOut().find((d) => d.slot === a.slot)!;
        strayed = Math.max(strayed, Math.hypot(him.x - art().markOf(a.figure, mark).x, him.z - mark.z));
      }
    });
    expect(stoodIn, "the control: figures stepped in").toBeGreaterThan(0);
    expect(peak, `the fastest part moved ${peak.toFixed(1)} m/s`).toBeLessThan(SETTLED_MPS);
    expect(strayed, `a figure got ${strayed.toFixed(1)} m from his mark`).toBeLessThan(1);
  });

  it(`when ${THROWS} men and women are thrown at the floor, then every dummy lands within ${CIRCLE_M + LANDED_M} m of the middle and none moves fast once they have landed`, () => {
    settle();
    for (let n = 0; n < THROWS; n++) {
      lookAtSet();
      throwAt(new THREE.Vector3(((n * 7) % 13) - 6, 0, 4 + (n % 5)), n % 2 === 0 ? "Digit8" : "Digit9");
      run(FRAME);
    }
    expect(ragdolls().builtSlots, "the control: every slot is built").toBe(SLOTS);
    run(LANDED_S);
    for (const d of dummiesOut()) {
      expect(Math.hypot(d.x, d.z), `slot ${d.slot} is at ${d.x.toFixed(1)}, ${d.z.toFixed(1)}`).toBeLessThan(CIRCLE_M + LANDED_M);
      expect(d.torsoSpeed, `slot ${d.slot}'s torso moves ${d.torsoSpeed.toFixed(1)} m/s`).toBeLessThan(TORSO_MPS);
    }
  });
});
