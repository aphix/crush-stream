import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { SimPacer } from "../engine/sim-pace.ts";
import { FRAME_HZ } from "../kernel/constants.ts";
import { launch, makeWorld, tickWorld } from "../contact/crash-scenarios.test-util.ts";
import type { DeformableCar } from "./car.ts";
import { drawnDoorCard } from "./car-door-mesh.ts";
import { PART_KIND } from "./part-geometry.ts";
import { VEHICLE_CLASS_IDS } from "./vehicle-classes.ts";
import { classCar } from "./ejection.test-util.ts";

/**
 * Owner, 2026-10-23, a replay of a police car hit on its front-left door: the door's black card (window switch, armrest) showed on
 * the white outer skin over its lower half as the door began to swing. The card is one rigid shape the part batch draws inside the
 * door, 4 cm under the skin's face; a hit dents the skin, which `skinPoints` writes vertex by vertex, and the card stood out through it.
 */
/** The sedan's closing speed (m/s) into the struck car's door: a dent 0.5-0.6 m deep, the door sprung and swinging. */
const SPEED = 25;
/** How often (frames) the door is looked at over the hit and the swing. */
const LOOK_EVERY = 6;
/** The least (m) the struck car must be crushed for a hit to count as a dent: the row says nothing for a door that was not struck. */
const DENTED = 0.2;

/** The most (m) any vertex of `car`'s door card on side `sign`, as the part batch draws it (the seat's world matrix), stands out of the door skin's outer face, read in the skin's own frame (so the door's swing is in it). */
function cardOutside(car: DeformableCar, sign: -1 | 1): number {
  car.group.updateMatrixWorld(true);
  const mesh = sign < 0 ? car["doorMeshL"] : car["doorMeshR"];
  const seat = car.partSeats[sign < 0 ? PART_KIND.liningL : PART_KIND.liningR]!;
  const toSkin = new THREE.Matrix4().copy(mesh.matrixWorld).invert().multiply(seat.matrixWorld);
  const card = drawnDoorCard(sign).getAttribute("position") as THREE.BufferAttribute;
  const skin = new THREE.Mesh(mesh.geometry);
  mesh.geometry.boundingSphere = null;
  mesh.geometry.boundingBox = null;
  const ray = new THREE.Raycaster();
  const at = new THREE.Vector3();
  let outside = -Infinity;
  for (let i = 0; i < card.count; i++) {
    at.fromBufferAttribute(card, i).applyMatrix4(toSkin);
    ray.set(new THREE.Vector3(sign * 2, at.y, at.z), new THREE.Vector3(-sign, 0, 0));
    const hit = ray.intersectObject(skin, false)[0];
    if (hit) outside = Math.max(outside, sign * (at.x - hit.point.x));
  }
  return outside;
}

/** A sedan driven into the right (+1) or left (-1) door of a parked car of class `cls`, looked at every `LOOK_EVERY` frames for 2.5 s: the card's worst stand-out (m) and when, how far it rode in (m), and how far the struck car was crushed (m). */
function tbone(cls: (typeof VEHICLE_CLASS_IDS)[number], sign: -1 | 1): { outside: number; ride: number; at: number; crush: number } {
  const struck = classCar(cls);
  const striker = classCar("sedan");
  launch(struck, 0, 0, 0, 0, 0);
  launch(striker, sign * 6, 0, (-sign * Math.PI) / 2, -sign * SPEED, 0);
  const w = makeWorld([striker, struck], false, false);
  const pace = new SimPacer();
  const seat = struck.partSeats[sign < 0 ? PART_KIND.liningL : PART_KIND.liningR]!;
  let outside = -Infinity;
  let ride = 0;
  let at = 0;
  for (let f = 0; f < FRAME_HZ * 2.5; f++) {
    tickWorld(w, 1 / FRAME_HZ, pace);
    if (f % LOOK_EVERY !== LOOK_EVERY - 1) continue;
    struck.updateSkin();
    ride = Math.max(ride, Math.abs(seat.position.x));
    const now = cardOutside(struck, sign);
    if (now > outside) {
      outside = now;
      at = f / FRAME_HZ;
    }
  }
  const crush = struck.deform.crushAmount;
  striker.dispose();
  struck.dispose();
  return { outside, ride, at, crush };
}

describe(`given a parked car of each class hit in a door by a sedan at ${SPEED} m/s`, () => {
  const doors = [...VEHICLE_CLASS_IDS.map((cls) => [cls, 1] as const), ["sedan", -1] as const];
  for (const [cls, sign] of doors) {
    it(`when the ${cls}'s ${sign < 0 ? "left" : "right"} door skin is dented and the door swings, then every vertex of its drawn card stands under the skin's outer face`, (t) => {
      const { outside, ride, at, crush } = tbone(cls, sign);
      t.annotate(`crushed ${crush.toFixed(3)} m; card worst ${(outside * 1000).toFixed(1)} mm out (negative: under), rode in ${(ride * 1000).toFixed(0)} mm, worst at ${at.toFixed(2)} s`);
      expect(crush, `the ${cls} was crushed only ${crush.toFixed(3)} m: the hit did not reach the door`).toBeGreaterThanOrEqual(DENTED);
      expect(outside, `a card vertex stood ${(outside * 1000).toFixed(1)} mm out of the dented skin at ${at.toFixed(2)} s (the card rode in ${(ride * 1000).toFixed(0)} mm)`).toBeLessThanOrEqual(0);
    });
  }
});
