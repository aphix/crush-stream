import * as THREE from "three";

/** The corners of a box as a unit cube centred on the origin, its faces' normals, and its two triangles a face: one set, read by every brick. */
const TEMPLATE = new THREE.BoxGeometry(1, 1, 1);
const TEMPLATE_POSITION = TEMPLATE.getAttribute("position").array as Float32Array;
const TEMPLATE_NORMAL = TEMPLATE.getAttribute("normal").array as Float32Array;
const TEMPLATE_INDEX = TEMPLATE.index!;
const POINT_FLOATS = 3;

/**
 * An axis-aligned box of size (w, h, d) centred at (x, y, z), as a `BoxGeometry` is but without its work arrays or its uv: two arrays (its corners, its normals) and the one index every brick shares,
 * for the hundreds of boxes a furnished room is made of. Its index is never written: whoever turns or moves a brick writes its own corners and normals.
 */
export function brick(w: number, h: number, d: number, x: number, y: number, z: number): THREE.BufferGeometry {
  const position = new Float32Array(TEMPLATE_POSITION.length);
  for (let at = 0; at < position.length; at += POINT_FLOATS) {
    position[at] = TEMPLATE_POSITION[at]! * w + x;
    position[at + 1] = TEMPLATE_POSITION[at + 1]! * h + y;
    position[at + 2] = TEMPLATE_POSITION[at + 2]! * d + z;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(position, POINT_FLOATS));
  geometry.setAttribute("normal", new THREE.BufferAttribute(TEMPLATE_NORMAL.slice(), POINT_FLOATS));
  geometry.setIndex(TEMPLATE_INDEX);
  return geometry;
}
