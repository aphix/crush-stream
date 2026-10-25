import * as THREE from "three";
import type { DeformableCar } from "./car.ts";
import { cageLift } from "./car-cage-rig.ts";

const at = new THREE.Vector3();

/** The car's body as world points (x, z): the cage's vertices, the drawn body as it stands crushed or whole, lifted and turned by the car's whole orientation (a wreck on its roof or side stands a car's height off where its heading's flat axes put it; not the wheel hubs, nor a torn lid's, which the cage leaves at rest and the sim never loads: `loadPoints`; a shattered pane's opening stays). */
export function bodyPoints(car: DeformableCar): [number, number][] {
  car.refitCage();
  const out: [number, number][] = [];
  const lift = cageLift(car);
  const { pos, panelOn } = car.cage.fields;
  const { vertexCount, vertexGroup, panelGlass } = car.cage.style;
  for (let k = 0; k < vertexCount; k++) {
    const g = vertexGroup[k]!;
    if (g > 0 && panelOn[g - 1] === 0 && panelGlass[g - 1] === 0) continue;
    at.set(pos[k * 3]!, pos[k * 3 + 1]! + lift, pos[k * 3 + 2]!).applyQuaternion(car.group.quaternion).add(car.group.position);
    out.push([at.x, at.z]);
  }
  return out;
}
