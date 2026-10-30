import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as THREE from "three";
import type { RigidBody } from "@dimforge/rapier3d-simd";
import "../kernel/rapier-node.test-util.ts";
import { PARTS } from "../present/ragdoll-body.ts";
import { SLOTS } from "../present/ragdoll-config.ts";
import { setGround } from "../world/ground.ts";
import type { CrashEngine } from "./engine.ts";
import { bootEngine, runSeconds, stubBrowser } from "./engine-headless.test-util.ts";
import { FRAME_HZ } from "../kernel/constants.ts";

const FRAME = 1 / FRAME_HZ;
/** The eye the presses were made from, looking at the set's middle. */
const EYE = [2.858906024135649, 3.155410742852837, 8] as const;
const LOOK = [0, 1, 0] as const;
/** Presses (frame, world point) on the back row's middle figure and the one beside him, then again on the two as they lie: the second's shin and foot end up through the first's chest. */
const PRESSES: readonly { frame: number; at: readonly [number, number, number] }[] = [
  { frame: 0, at: [0.7959885697346181, 0.8725755039602519, -2.5] },
  { frame: 9, at: [0.840122640132904, 0.623457133769989, -0.331116646528244] },
  { frame: 15, at: [0.6668077111244202, 0.5107755661010742, -0.6074296236038208] },
  { frame: 34, at: [0.8475479483604431, 0.2131529301404953, -2.3023927211761475] },
  { frame: 40, at: [0.8393874742789194, 1.2010373875498772, 0] },
  { frame: 51, at: [0.726533456146717, 1.016869365796447, -2.5] },
  { frame: 60, at: [0.697613537311554, 0.10043560713529587, -1.530249834060669] },
  { frame: 73, at: [0.8174142241477966, 0.5843535661697388, -2.9101672172546387] },
  { frame: 91, at: [0.7521543502807617, 0.15181757509708405, -1.6864997148513794] },
  { frame: 97, at: [1.2900612354278564, 0.13658347725868225, -3.896531343460083] },
  { frame: 105, at: [0.30558690428733826, 0.04920406639575958, -2.313683032989502] },
];
/** A point of a limb this far (m) inside a torso's box is through it, not touching it. */
const INSIDE = 0.01;
const TORSO = PARTS[0].h;
/** How long (s) a limb may stay through another dummy's torso: the time the contacts take to push it out. */
const FREED_WITHIN = 0.5;
const WATCH_SECONDS = 8;

const _q = new THREE.Quaternion();
const _r = new THREE.Quaternion();
const _a = new THREE.Vector3();

/** Whether a point of part `k`'s long axis (its ends, quarters and middle) is `INSIDE` m inside `torso`'s box. */
function through(limb: RigidBody, k: number, torso: RigidBody): boolean {
  const t = torso.translation();
  const tr = torso.rotation();
  _q.set(tr.x, tr.y, tr.z, tr.w).invert();
  const p = limb.translation();
  const pr = limb.rotation();
  _r.set(pr.x, pr.y, pr.z, pr.w);
  const h = PARTS[k]!.h;
  const long = h[2] > h[1] ? 2 : 1;
  for (let s = -1; s <= 1; s += 0.5) {
    _a.set(0, long === 1 ? s * h[1] : 0, long === 2 ? s * h[2] : 0).applyQuaternion(_r);
    _a.set(p.x + _a.x - t.x, p.y + _a.y - t.y, p.z + _a.z - t.z).applyQuaternion(_q);
    if (Math.abs(_a.x) < TORSO[0] - INSIDE && Math.abs(_a.y) < TORSO[1] - INSIDE && Math.abs(_a.z) < TORSO[2] - INSIDE) return true;
  }
  return false;
}

describe("given the real engine booted on #scene=showcase", () => {
  let engine: CrashEngine;
  const dolls = (): { live: boolean; bodies: RigidBody[] }[] => engine["ragdolls"]["dolls"];

  /** Whether any limb of one live dummy is through another live dummy's torso. */
  const tangled = (): boolean => {
    const all = dolls();
    for (let a = 0; a < SLOTS; a++) {
      for (let b = 0; b < SLOTS; b++) {
        if (a === b || !all[a]!.live || !all[b]!.live) continue;
        for (let k = 2; k < PARTS.length; k++) if (through(all[a]!.bodies[k]!, k, all[b]!.bodies[0]!)) return true;
      }
    }
    return false;
  };

  beforeAll(async () => {
    stubBrowser();
    globalThis.location.hash = "#scene=showcase";
    engine = await bootEngine();
    await engine["ragdolls"].preload();
    runSeconds(engine, 0.5);
  });
  afterAll(() => {
    engine.dispose();
    setGround(null);
  });

  it(`when two figures are pressed so one falls with his leg through the other's chest, then the leg is out of it within ${FREED_WITHIN} s`, () => {
    engine.reset();
    const camera = engine["camera"];
    camera.clearViewOffset();
    camera.aspect = 800 / 600;
    camera.updateProjectionMatrix();
    camera.position.set(...EYE);
    camera.lookAt(...LOOK);
    camera.updateMatrixWorld(true);
    runSeconds(engine, 0.2);
    let inside = 0;
    let longest = 0;
    for (let f = 0; f < WATCH_SECONDS * FRAME_HZ; f++) {
      for (const press of PRESSES) {
        if (press.frame !== f) continue;
        const p = new THREE.Vector3(...press.at).project(camera);
        engine["view"].take!.down(((p.x + 1) / 2) * 800, ((1 - p.y) / 2) * 600, 0);
      }
      engine.advance(FRAME, { frameDt: FRAME });
      inside = tangled() ? inside + FRAME : 0;
      longest = Math.max(longest, inside);
    }
    expect(longest, `a leg stayed through another dummy's chest for ${longest.toFixed(2)} s`).toBeLessThan(FREED_WITHIN);
  });
});
