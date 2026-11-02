import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { DeformableCar } from "./car.ts";
import { LampLights } from "./lamp-lights.ts";
import { paint } from "./test-support.ts";

/** A sedan with every `lampWorld` call it gets noted: the lamp asked, and whether the caller said the seats' parents were current. */
function watched(): { car: DeformableCar; lights: LampLights; camera: THREE.PerspectiveCamera; asked: [number, boolean][] } {
  const scene = new THREE.Scene();
  const car = new DeformableCar(paint(), scene);
  car.spawnFacing(0, 0, 0, 0);
  car.group.updateMatrixWorld(true);
  const asked: [number, boolean][] = [];
  const ask = car.lampWorld.bind(car);
  car.lampWorld = (i, pos, dir, parentsCurrent = false) => {
    asked.push([i, parentsCurrent]);
    return ask(i, pos, dir, parentsCurrent);
  };
  const camera = new THREE.PerspectiveCamera(50, 16 / 9, 0.1, 200);
  camera.position.copy(car.group.position).addScaledVector(car.forward, -8).setY(1.5);
  camera.lookAt(car.group.position);
  camera.updateMatrixWorld(true);
  return { car, lights: new LampLights(scene, car.lampCount), camera, asked };
}

describe("given a sedan the lamp pool lights", () => {
  it("when it is day and the car is not braking, then no lamp's seat is asked: the head lamps and running tails are dark whatever their matrices say", () => {
    const { car, lights, camera, asked } = watched();
    lights.night = false;
    lights.update([car], camera, null);
    expect(asked).toEqual([]);
  });

  it("when it is day and the car brakes, then only its tail lamps are asked, and the first of them brings the seats' parents up to date (it is told they are not current)", () => {
    const { car, lights, camera, asked } = watched();
    lights.night = false;
    car.drive.brake = 1;
    lights.update([car], camera, null);
    const tails = car.lamps.flatMap((l, i) => (l.kind === "tail" ? [i] : []));
    expect(tails.length, "the control: the sedan has tail lamps").toBeGreaterThan(0);
    expect(asked.map(([i]) => i).join(), "the lamps asked").toBe(tails.join());
    expect(asked.map(([, current]) => current).join(), "told current").toBe(tails.map((_, k) => k > 0).join());
  });

  it("when it is night, then every lamp is asked once, the first one told the parents are not current", () => {
    const { car, lights, camera, asked } = watched();
    lights.night = true;
    lights.update([car], camera, null);
    expect(asked.map(([i]) => i).join(), "the lamps asked").toBe(car.lamps.map((_, i) => i).join());
    expect(asked.map(([, current]) => current).join(), "told current").toBe(car.lamps.map((_, i) => i > 0).join());
  });
});
