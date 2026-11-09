import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { recordFlat, type Recording, type Spawn } from "./replay-fidelity.test-util.ts";
import { ClipSim } from "./engine-replay.ts";
import type { DeformableCar } from "../vehicle/car.ts";
import { FRAME_HZ } from "../kernel/constants.ts";

/**
 * The reel plays a clip again in the same process, on the cars it played it on before: a replay starts from the clip's first keyframe and must not
 * carry anything of the play (or the recording) before it. Every car's group, wheels and parts, every frame, to the bit.
 */
const HEAD = Math.PI / 2;
/** The pile-up of replay-blend.test.ts: two head-on, one behind, one across; wrecks shed parts and pop wheels. */
const PILE: Spawn[] = [
  { x: 0, z: 0, yaw: HEAD, speed: 20, throttle: 1 },
  { x: 80, z: 0, yaw: -HEAD, speed: 20, throttle: 1 },
  { x: -12, z: 0.5, yaw: HEAD, speed: 20, throttle: 1 },
  { x: 40, z: 60, yaw: Math.PI, speed: 20, throttle: 1 },
];
/** The clip's time per drawn frame (s): a tenth of a rendered frame, as the slow-motion reel draws it (frames shorter than a step blend between steps). */
const FRAME_S = 1 / (10 * FRAME_HZ);
/** Clip seconds drawn: what a replay carries over from the play before it shows in its first frames. */
const PLAY_S = 2;
/** Numbers per sample: world (or, for a part on its car, local) position, quaternion, and 1 for a hinged part still on the car. */
const WIDTH = 8;

type Entity = { label: string; object: THREE.Object3D; onCar: { detached: boolean } | null };

function entities(cars: readonly DeformableCar[]): Entity[] {
  const out: Entity[] = [];
  for (const [ci, c] of cars.entries()) {
    out.push({ label: `car ${ci} group`, object: c.group, onCar: null });
    for (const [wi, w] of c.wheels.entries()) out.push({ label: `car ${ci} wheel ${wi}`, object: w, onCar: null });
    for (const [pi, p] of c["parts"].entries()) {
      out.push({ label: `car ${ci} part ${pi} in the world`, object: p.object, onCar: null });
      out.push({ label: `car ${ci} part ${pi} on its car`, object: p.object, onCar: p });
    }
  }
  return out;
}

const _p = new THREE.Vector3();
const _q = new THREE.Quaternion();

/** A part on its car is read in its car's frame (the car's own motion would move it every frame), anything else in the world. */
function sampleInto(e: Entity, buf: Float64Array, at: number): void {
  const o = e.object;
  if (e.onCar) {
    o.position.toArray(buf, at);
    o.quaternion.toArray(buf, at + 3);
    buf[at + 7] = e.onCar.detached ? 0 : 1;
    return;
  }
  o.updateWorldMatrix(true, false);
  o.getWorldPosition(_p).toArray(buf, at);
  o.getWorldQuaternion(_q).toArray(buf, at + 3);
  buf[at + 7] = 1;
}

type Play = { labels: string[]; frames: number; poses: Float64Array[] };

/** The clip played from its start on `cars` as the reel draws it (`ClipSim.present`, then each car's skin and the blend), every entity sampled on every frame. */
function play(rec: Recording): Play {
  const cars = rec.clip.cars.map((c) => rec.cars[c.slot]!);
  const sim = new ClipSim(rec.clip, cars, rec.scene);
  sim.restart();
  const ents = entities(cars);
  const poses = ents.map(() => new Float64Array((Math.ceil(PLAY_S / FRAME_S) + 2) * WIDTH));
  let t = 0;
  let frames = 0;
  while (t < Math.min(sim.length, PLAY_S) - FRAME_S) {
    t += FRAME_S;
    sim.advanceTo(t);
    sim.present(t);
    for (const c of cars) c.updateSkin();
    rec.scene.blend.refresh();
    for (let i = 0; i < ents.length; i++) sampleInto(ents[i]!, poses[i]!, frames * WIDTH);
    frames++;
    rec.scene.blend.restore();
  }
  return { labels: ents.map((e) => e.label), frames, poses };
}

/** The largest difference between the two plays' numbers, and where (frame, entity, number). */
function worstDifference(a: Play, b: Play): { worst: number; where: string } {
  let worst = 0;
  let where = "";
  for (let f = 0; f < a.frames; f++) {
    for (let i = 0; i < a.labels.length; i++) {
      for (let k = 0; k < WIDTH; k++) {
        const x = a.poses[i]![f * WIDTH + k]!;
        const y = b.poses[i]![f * WIDTH + k]!;
        if (Object.is(x, y)) continue;
        const d = Math.abs(x - y);
        if (d <= worst) continue;
        worst = d;
        where = `frame ${f}, ${a.labels[i]}, number ${k}: ${x} against ${y}`;
      }
    }
  }
  return { worst, where };
}

describe("given a pile-up recorded once and its clip replayed twice on the same cars in one process", () => {
  // Mutations (each turns this row red): `sed 's|^    this.blend.forget(this.cars);$||'` on engine-replay.ts (the second replay blends the first's last poses into its first frames);
  // `sed 's|new CarBlend(car, this.steps)|new CarBlend(car, 0)|'` on pose-blend.ts (a car tracked afresh blends its first segment over every step the blend ever counted).
  it(`when the second replay is drawn, then every car, wheel and part is posed exactly as in the first, on every frame of its first ${PLAY_S} s`, () => {
    const rec = recordFlat(PILE, 8, false);
    const first = play(rec);
    const second = play(rec);
    expect(first.frames * first.labels.length, "(frame, entity) pairs compared").toBeGreaterThan(50000);
    const { worst, where } = worstDifference(first, second);
    expect(worst, `the second replay differs from the first by ${worst}, at ${where}`).toBe(0);
  });
});
