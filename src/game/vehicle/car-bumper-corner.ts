import type * as THREE from "three";

/** A bumper's underside is a lip a row or two deep: its corner is the outermost point within this much (m) of its lowest. */
const CORNER_BAND = 0.015;

/** A bumper's bottom corner on its +x side, in the bumper mesh's own frame (m). */
interface BumperCorner {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/** The bumper mesh's bottom corner: the outermost vertex within `CORNER_BAND` of its lowest, so the drawn lip and the collision cage meet at one point. */
export function bumperCorner(geometry: THREE.BufferGeometry): BumperCorner {
  const pos = geometry.getAttribute("position");
  let low = Infinity;
  for (let i = 0; i < pos.count; i++) low = Math.min(low, pos.getY(i));
  let corner = -1;
  for (let i = 0; i < pos.count; i++) {
    if (pos.getY(i) > low + CORNER_BAND) continue;
    if (corner < 0 || Math.abs(pos.getX(i)) > Math.abs(pos.getX(corner))) corner = i;
  }
  return { x: Math.abs(pos.getX(corner)), y: pos.getY(corner), z: pos.getZ(corner) };
}
