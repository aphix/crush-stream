import { describe, expect, it } from "vitest";
import type * as THREE from "three";
import type { DeformableCar } from "../vehicle/car.ts";
import { MotorSound } from "./motor-sound.ts";

/** A camera at the origin; `update` reads only its world matrix. */
const CAMERA = { matrixWorld: { elements: new Array<number>(16).fill(0) } } as unknown as THREE.Camera;
/** Short enough that the few frames of a test stay under a parameter tick (1/30 s), so no voice is driven. */
const FRAME_S = 1 / 300;

function carAt(x: number): DeformableCar {
  return { group: { position: { x, y: 0, z: 0, copy() {} }, visible: true }, vaporized: false, deform: { drivetrainAlive: true } } as unknown as DeformableCar;
}

/** A ready sound with no voices: frames shorter than a tick only seat cars in the pool. */
function seatedSound(): { sound: MotorSound; held: () => number } {
  const sound = new MotorSound(1);
  const state = sound as unknown as { ready: boolean; context: object; pool: { car: Int32Array } };
  state.ready = true;
  state.context = {};
  return { sound, held: () => state.pool.car[0]! };
}

describe("given a car with a voice that drifts across the 70 m cutoff", () => {
  it("when it hovers between 70 and 77 m, then it keeps its voice", () => {
    const { sound, held } = seatedSound();
    const car = carAt(60);
    sound.update(FRAME_S, [car], CAMERA, null, 1, false);
    expect(held()).toBe(0);
    for (const x of [71, 69, 74, 70.5, 76]) {
      car.group.position.x = x;
      sound.update(FRAME_S, [car], CAMERA, null, 1, false);
      expect(held(), `lost its voice at ${x} m`).toBe(0);
    }
  });

  it("when it passes 77 m, then it frees the voice, and it needs to come back under 70 m to take one again", () => {
    const { sound, held } = seatedSound();
    const car = carAt(60);
    sound.update(FRAME_S, [car], CAMERA, null, 1, false);
    car.group.position.x = 78;
    sound.update(FRAME_S, [car], CAMERA, null, 1, false);
    expect(held()).toBe(-1);
    car.group.position.x = 72;
    sound.update(FRAME_S, [car], CAMERA, null, 1, false);
    expect(held()).toBe(-1);
    car.group.position.x = 69;
    sound.update(FRAME_S, [car], CAMERA, null, 1, false);
    expect(held()).toBe(0);
  });
});
