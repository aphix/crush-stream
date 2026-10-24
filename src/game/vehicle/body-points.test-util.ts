import type { DeformableCar } from "./car.ts";

/** The car's body as world points (x, z): the cage's vertices, the drawn body as it stands crushed or whole (not the wheel hubs, nor a torn lid's, which the cage leaves at rest and the sim never loads: `loadPoints`; a shattered pane's opening stays). */
export function bodyPoints(car: DeformableCar): [number, number][] {
  car.refitCage();
  const out: [number, number][] = [];
  const p = car.group.position;
  const c = Math.cos(car.yaw);
  const s = Math.sin(car.yaw);
  const { pos, panelOn } = car.cage.fields;
  const { vertexCount, vertexGroup, panelGlass } = car.cage.style;
  for (let k = 0; k < vertexCount; k++) {
    const g = vertexGroup[k]!;
    if (g > 0 && panelOn[g - 1] === 0 && panelGlass[g - 1] === 0) continue;
    const lx = pos[k * 3]!;
    const lz = pos[k * 3 + 2]!;
    out.push([p.x + lx * c + lz * s, p.z - lx * s + lz * c]);
  }
  return out;
}
