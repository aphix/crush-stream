import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { recordFlat, type Spawn } from "./replay-fidelity.test-util.ts";
import { ClipSim } from "./engine-replay.ts";
import { EPICENTER, epicenterValues, loadEpicenter } from "../deform/epicenter.ts";
import { DeformableCar } from "../vehicle/car.ts";
import { assertSameNumbers } from "../vehicle/test-support.ts";

/**
 * Owner, 2026-10-09 (docs/HIGHLIGHTS.md, clip review issue 6): in a slow-mo replay every drawn part of a car moves on every drawn frame, the
 * torn and hinged parts and the popped wheels included. The reel draws through live play's `PoseBlend` (`ClipSim.present`): every part the
 * blend carries is between the pose before the step it is in and the one it left. Measured on the lane before the change (the group alone
 * was blended): DYZ7-QCXS `6.bumperF` moved on 27.8 % of its moving frames, `3.archFR` on 45.3 %, torn parts 91.5 % / 94.2 % at 60 / 120 fps.
 * The bar is the owner's: at least 95 % of the slow-mo frames on which a part really moves (more than 5 mm over the 3 frames either side).
 */
const HEAD = Math.PI / 2;
/** The pile-up of replay-fidelity.test.ts: two head-on, one behind, one across; wrecks shed parts and pop wheels. */
const PILE: Spawn[] = [
  { x: 0, z: 0, yaw: HEAD, speed: 20, throttle: 1 },
  { x: 80, z: 0, yaw: -HEAD, speed: 20, throttle: 1 },
  { x: -12, z: 0.5, yaw: HEAD, speed: 20, throttle: 1 },
  { x: 40, z: 60, yaw: Math.PI, speed: 20, throttle: 1 },
];
/** Slow-mo: the clip's time per drawn frame (s): a 1/60 s frame at 0.1x (about 0.4 of a 1/240 s step) and at 0.2x. */
const FRAME_S = [1 / 600, 1 / 300];
/** An entity moves on a frame when its world position or orientation changed by more than this. */
const EPS_POS = 1e-5;
const EPS_ROT = 1e-6;
/** It really moves where it is further than this (m) from itself 3 frames either side. */
const MOVING = 0.005;
const BAR = 0.95;

/** `skin`: a geometry the crush skin writes (`DeformableCar.skinGeometries`), its points' x and z only (the tyre hold lifts them in y on every frame its drawn wheel moved). */
type Class = "group" | "classLift" | "wheel" | "part" | "hinged" | "skin";
/** `on`: for a hinged sample, the part is still on the car (its local pose is what is drawn). */
type Pose = { p: THREE.Vector3; q: THREE.Quaternion; on: boolean };

/** A part's local pose changes by more than this (rad) over 3 frames either side: a hinge swinging in place has no travel to measure. */
const MOVING_ROT = 0.005;

type Entity = { cls: Class; object: THREE.Object3D; part?: { detached: boolean } };

function entities(cars: readonly DeformableCar[]): Entity[] {
  const out: Entity[] = [];
  for (const c of cars) {
    out.push({ cls: "group", object: c.group });
    const body = c["classBodyObject"]();
    if (body) out.push({ cls: "classLift", object: body });
    for (const w of c.wheels) out.push({ cls: "wheel", object: w });
    for (const p of c["parts"]) {
      out.push({ cls: "part", object: p.object });
      out.push({ cls: "hinged", object: p.object, part: p });
    }
  }
  return out;
}

/** World pose, except a hinged part's: its pose on the car, since the car's own motion would move it on every frame whatever its hinge did. */
function sample(e: Entity): Pose {
  const o = e.object;
  if (e.cls === "hinged") return { p: o.position.clone(), q: o.quaternion.clone(), on: !e.part!.detached };
  o.updateWorldMatrix(true, false);
  return { p: o.getWorldPosition(new THREE.Vector3()), q: o.getWorldQuaternion(new THREE.Quaternion()), on: true };
}

/** The two poses differ by more than the bar's own threshold for a frame to have changed. */
function moved(a: Pose, b: Pose): boolean {
  return a.p.distanceTo(b.p) > EPS_POS || a.q.angleTo(b.q) > EPS_ROT;
}

/** The largest x or z move (m) of any point of `now` from `last`, which then takes `now`. */
function planarStep(now: Float32Array, last: Float32Array): number {
  let most = 0;
  for (let i = 0; i < now.length; i += 3) most = Math.max(most, Math.abs(now[i]! - last[i]!), Math.abs(now[i + 2]! - last[i + 2]!));
  last.set(now);
  return most;
}

/** Per class: the frames on which an entity moves, and the ones among them on which its drawn pose changed since the frame before. */
/** `skip`: `EPICENTER.presentSkip`, which poses the parts only when what the pose reads changed (so not on the frames between two steps); `calls` counts the poses written. */
function shares(dt: number, skip: 0 | 1): { rows: Record<Class, { moving: number; changed: number }>; calls: number } {
  const rec = recordFlat(PILE, 8, false);
  const cars = rec.clip.cars.map((c) => rec.cars[c.slot]!);
  const blend = rec.scene.blend;
  const sim = new ClipSim(rec.clip, cars, rec.scene);
  sim.restart();
  EPICENTER.presentSkip = skip;
  const proto = DeformableCar.prototype as unknown as { posePart: (p: unknown) => void };
  const real = proto.posePart;
  let calls = 0;
  proto.posePart = function (this: DeformableCar, p: unknown) {
    calls++;
    real.call(this, p);
  };
  const ents = entities(cars);
  const series: Pose[][] = ents.map(() => []);
  const skins = cars.flatMap((c) => c.skinGeometries().map((g) => g.getAttribute("position") as THREE.BufferAttribute));
  const skinLast = skins.map((a) => Float32Array.from(a.array as Float32Array));
  const skinSteps: number[][] = skins.map(() => []);
  let t = 0;
  try {
    while (t < sim.length - dt) {
      t += dt;
      sim.advanceTo(t);
      sim.present(t);
      // The reel's order (`Engine.frame`): the cars skin and pose their parts after the blend, which then draws those writes.
      for (const c of cars) c.updateSkin();
      blend.refresh();
      for (let i = 0; i < ents.length; i++) series[i]!.push(sample(ents[i]!));
      for (let i = 0; i < skins.length; i++) skinSteps[i]!.push(planarStep(skins[i]!.array as Float32Array, skinLast[i]!));
      blend.restore();
    }
  } finally {
    proto.posePart = real;
  }
  const none = (): { moving: number; changed: number } => ({ moving: 0, changed: 0 });
  const out: Record<Class, { moving: number; changed: number }> = { group: none(), classLift: none(), wheel: none(), part: none(), hinged: none(), skin: none() };
  for (let i = 0; i < ents.length; i++) {
    const s = series[i]!;
    const hinged = ents[i]!.cls === "hinged";
    for (let f = 3; f < s.length - 3; f++) {
      if (hinged) {
        // Attached over the whole window, or the part is a free body and counted in `part`.
        if (!s.slice(f - 3, f + 4).every((x) => x.on)) continue;
        if (s[f - 3]!.p.distanceTo(s[f + 3]!.p) <= MOVING && s[f - 3]!.q.angleTo(s[f + 3]!.q) <= MOVING_ROT) continue;
        // A hinge starts and stops: the 3 frames before its first move and after its last are not frames it moves on (a part's world pose moves with the car from the first frame, so `part` has no such edge).
        if (!moved(s[f]!, s[f - 3]!) || !moved(s[f]!, s[f + 3]!)) continue;
      } else if (s[f - 3]!.p.distanceTo(s[f + 3]!.p) <= MOVING) continue;
      out[ents[i]!.cls].moving++;
      if (moved(s[f]!, s[f - 1]!)) out[ents[i]!.cls].changed++;
    }
  }
  // A skin moves on a frame when its points moved in the 3 frames up to it and in the 3 after, by more than `MOVING` in all (each frame's farthest point
  // summed): a crush starts and stops, and its still frames either side are not frames it moves on.
  for (const steps of skinSteps) {
    for (let f = 3; f < steps.length - 3; f++) {
      const before = steps[f - 2]! + steps[f - 1]! + steps[f]!;
      const after = steps[f + 1]! + steps[f + 2]! + steps[f + 3]!;
      if (before <= EPS_POS || after <= EPS_POS || before + after <= MOVING) continue;
      out.skin.moving++;
      if (steps[f]! > EPS_POS) out.skin.changed++;
    }
  }
  return { rows: out, calls };
}

const saved = epicenterValues();
afterEach(() => loadEpicenter(saved));

describe("given a crash replayed in slow motion from its clip", () => {
  for (const frame of FRAME_S) {
    it(`when frames of ${(frame * 1000).toFixed(2)} ms of the clip (a 1/60 s frame at ${(frame * 60).toFixed(1)}x) are drawn, with presentSkip off and on, then every class of drawn part changes pose on at least ${BAR * 100} % of the frames it moves on`, () => {
      const every = shares(frame, 0);
      const skipping = shares(frame, 1);
      // The skipping run must be one that skips (parts posed only when their inputs changed), or it proves nothing about presentSkip. The cars move all through this clip, so it skips little (a still wreck skips almost every pose: pose-skip.test.ts).
      assert.ok(skipping.calls < every.calls, `${skipping.calls} part poses with presentSkip against ${every.calls} without`);
      for (const [name, { rows: s }] of [["presentSkip 0", every], ["presentSkip 1", skipping]] as const) {
        const rows = (Object.keys(s) as Class[]).map((c) => `${c} ${s[c].changed}/${s[c].moving}`).join(", ");
        assert.ok(s.part.moving > 100, `${name}: the clip sheds parts that move (${rows})`);
        assert.ok(s.hinged.moving > 20, `${name}: the clip moves parts that are still on the car (${rows})`);
        assert.ok(s.wheel.moving > 100 && s.classLift.moving > 100 && s.group.moving > 100 && s.skin.moving > 100, `${name}: ${rows}`);
        for (const c of Object.keys(s) as Class[]) assert.ok(s[c].changed >= BAR * s[c].moving, `${name}, ${c}: ${(s[c].changed / s[c].moving).toFixed(3)} of its moving frames change (${rows})`);
      }
    });
  }

  it("when a frame is drawn between two steps and handed back, then the sim's own pose of every car is exactly what it was", () => {
    const rec = recordFlat(PILE, 8, false);
    const cars = rec.clip.cars.map((c) => rec.cars[c.slot]!);
    const sim = new ClipSim(rec.clip, cars, rec.scene);
    sim.restart();
    sim.advanceTo(2.3);
    const poses = (): number[] =>
      cars.flatMap((c) => [
        ...c.group.position.toArray(),
        ...c.group.quaternion.toArray(),
        ...c["parts"].filter((p) => !p.detached).flatMap((p) => [...p.object.position.toArray(), ...p.object.quaternion.toArray(), ...p.object.scale.toArray()]),
      ]);
    const before = poses();
    sim.present(sim.time - 0.001);
    const drawn = poses();
    assert.ok(drawn.some((v, i) => v !== before[i]), "the drawn pose is between the steps");
    rec.scene.blend.restore();
    assertSameNumbers(poses(), before, "the sim's own pose handed back");
  });
});
